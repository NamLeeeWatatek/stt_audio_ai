package adapters

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"scriberr/internal/transcription/interfaces"
)

// GroqAdapter implements the TranscriptionAdapter interface for Groq API
type GroqAdapter struct {
	*BaseAdapter
	apiKey string
}

// NewGroqAdapter creates a new Groq adapter
func NewGroqAdapter(apiKey string) *GroqAdapter {
	capabilities := interfaces.ModelCapabilities{
		ModelID:     "groq_whisper",
		ModelFamily: "groq",
		DisplayName: "Groq Whisper API",
		Description: "Ultra-fast cloud transcription using Groq's LPU inference engine",
		Version:     "v1",
		SupportedLanguages: []string{
			"af", "ar", "hy", "az", "be", "bs", "bg", "ca", "zh", "hr", "cs", "da", "nl", "en", "et", "fi", "fr", "gl", "de", "el", "he", "hi", "hu", "is", "id", "it", "ja", "kn", "kk", "ko", "lv", "lt", "mk", "ms", "mr", "mi", "ne", "no", "fa", "pl", "pt", "ro", "ru", "sr", "sk", "sl", "es", "sw", "sv", "tl", "ta", "th", "tr", "uk", "ur", "vi", "cy",
		},
		SupportedFormats:  []string{"flac", "mp3", "mp4", "mpeg", "mpga", "m4a", "ogg", "wav", "webm"},
		RequiresGPU:       false,
		MemoryRequirement: 0, // Cloud-based
		Features: map[string]bool{
			"timestamps":         true,
			"word_level":         false, // Not directly supported in standard verbose_json without extra parsing? Groq supports it via verbose_json
			"diarization":        false, // Not native yet
			"translation":        true,
			"language_detection": true,
			"vad":                true,
		},
		Metadata: map[string]string{
			"provider": "groq",
			"api_url":  "https://api.groq.com/openai/v1/audio/transcriptions",
		},
	}

	schema := []interfaces.ParameterSchema{
		{
			Name:        "api_key",
			Type:        "string",
			Required:    false,
			Description: "Groq API Key (overrides system default)",
			Group:       "authentication",
		},
		{
			Name:        "model",
			Type:        "string",
			Required:    false,
			Default:     "whisper-large-v3",
			Options:     []string{"whisper-large-v3", "whisper-large-v3-turbo", "distil-whisper-large-v3-en"},
			Description: "Groq Whisper model to use",
			Group:       "basic",
		},
		{
			Name:        "language",
			Type:        "string",
			Required:    false,
			Description: "Language of the input audio (ISO-639-1)",
			Group:       "basic",
		},
		{
			Name:        "prompt",
			Type:        "string",
			Required:    false,
			Description: "Optional text to guide the model style",
			Group:       "advanced",
		},
		{
			Name:        "temperature",
			Type:        "float",
			Required:    false,
			Default:     0.0,
			Min:         &[]float64{0.0}[0],
			Max:         &[]float64{1.0}[0],
			Description: "Sampling temperature",
			Group:       "quality",
		},
	}

	baseAdapter := NewBaseAdapter("groq_whisper", "", capabilities, schema)

	return &GroqAdapter{
		BaseAdapter: baseAdapter,
		apiKey:      apiKey,
	}
}

// GetSupportedModels returns the list of Groq models supported
func (a *GroqAdapter) GetSupportedModels() []string {
	return []string{"whisper-large-v3", "whisper-large-v3-turbo", "distil-whisper-large-v3-en"}
}

// PrepareEnvironment is a no-op for cloud adapters
func (a *GroqAdapter) PrepareEnvironment(ctx context.Context) error {
	a.initialized = true
	return nil
}

// Transcribe processes audio using Groq API
func (a *GroqAdapter) Transcribe(ctx context.Context, input interfaces.AudioInput, params map[string]interface{}, procCtx interfaces.ProcessingContext) (*interfaces.TranscriptResult, error) {
	startTime := time.Now()
	a.LogProcessingStart(input, procCtx)
	defer func() {
		a.LogProcessingEnd(procCtx, time.Since(startTime), nil)
	}()

	// Helper local logger
	writeLog := func(format string, args ...interface{}) {
		// Log to stdout for Docker capture
		timestamp := time.Now().Format("2006-01-02 15:04:05")
		fmt.Printf("[%s] [GroqAdapter] %s\n", timestamp, fmt.Sprintf(format, args...))
	}

	writeLog("Starting Groq transcription for job %s", procCtx.JobID)

	// Validate
	if err := a.ValidateAudioInput(input); err != nil {
		return nil, fmt.Errorf("invalid audio input: %w", err)
	}

	apiKey := a.apiKey
	if key, ok := params["api_key"].(string); ok && key != "" {
		apiKey = key
	}

	if apiKey == "" {
		return nil, fmt.Errorf("Groq API key is required but not provided")
	}

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	// Add file
	file, err := os.Open(input.FilePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open audio file: %w", err)
	}
	defer file.Close()

	part, err := writer.CreateFormFile("file", filepath.Base(input.FilePath))
	if err != nil {
		return nil, fmt.Errorf("failed to create form file: %w", err)
	}
	if _, err := io.Copy(part, file); err != nil {
		return nil, fmt.Errorf("failed to copy file content: %w", err)
	}

	// Parameters
	model := a.GetStringParameter(params, "model")
	if model == "" {
		model = "whisper-large-v3"
	}
	_ = writer.WriteField("model", model)
	_ = writer.WriteField("response_format", "verbose_json") // Always request verbose for segments

	if lang := a.GetStringParameter(params, "language"); lang != "" {
		_ = writer.WriteField("language", lang)
	}
	if prompt := a.GetStringParameter(params, "prompt"); prompt != "" {
		_ = writer.WriteField("prompt", prompt)
	}
	temp := a.GetFloatParameter(params, "temperature")
	_ = writer.WriteField("temperature", fmt.Sprintf("%.2f", temp))

	if err := writer.Close(); err != nil {
		return nil, fmt.Errorf("failed to close multipart writer: %w", err)
	}

	// Request
	req, err := http.NewRequestWithContext(ctx, "POST", "https://api.groq.com/openai/v1/audio/transcriptions", body)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{Timeout: 10 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("groq API error (status %d): %s", resp.StatusCode, string(respBody))
	}

	// Parse
	var groqResponse struct {
		Task     string  `json:"task"`
		Language string  `json:"language"`
		Duration float64 `json:"duration"`
		Text     string  `json:"text"`
		Segments []struct {
			ID               int     `json:"id"`
			Seek             int     `json:"seek"`
			Start            float64 `json:"start"`
			End              float64 `json:"end"`
			Text             string  `json:"text"`
			Tokens           []int   `json:"tokens"`
			Temperature      float64 `json:"temperature"`
			AvgLogprob       float64 `json:"avg_logprob"`
			CompressionRatio float64 `json:"compression_ratio"`
			NoSpeechProb     float64 `json:"no_speech_prob"`
		} `json:"segments"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&groqResponse); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	// Result
	result := &interfaces.TranscriptResult{
		Language:       groqResponse.Language,
		Text:           groqResponse.Text,
		Segments:       make([]interfaces.TranscriptSegment, len(groqResponse.Segments)),
		ProcessingTime: time.Since(startTime),
		ModelUsed:      model,
		Metadata:       a.CreateDefaultMetadata(params),
	}

	for i, seg := range groqResponse.Segments {
		result.Segments[i] = interfaces.TranscriptSegment{
			Start: seg.Start,
			End:   seg.End,
			Text:  seg.Text,
		}
	}
	
	// Fallback if no segments
	if len(result.Segments) == 0 && result.Text != "" {
		result.Segments = []interfaces.TranscriptSegment{{
			Start: 0,
			End:   groqResponse.Duration,
			Text:  result.Text,
		}}
	}

	return result, nil
}

// GetEstimatedProcessingTime
func (a *GroqAdapter) GetEstimatedProcessingTime(input interfaces.AudioInput) time.Duration {
	// Groq is extremely fast (LPU), usually < 1/10th realtime
	if input.Duration == 0 {
		return 5 * time.Second
	}
	return time.Duration(float64(input.Duration) * 0.05)
}
