package adapters

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"scriberr/internal/transcription/interfaces"
)

// FPTAdapter implements the TranscriptionAdapter interface for FPT AI API
type FPTAdapter struct {
	*BaseAdapter
	apiKey string
}

// NewFPTAdapter creates a new FPT AI adapter
func NewFPTAdapter(apiKey string) *FPTAdapter {
	capabilities := interfaces.ModelCapabilities{
		ModelID:     "fpt_ai",
		ModelFamily: "fpt",
		DisplayName: "FPT AI Speech-to-Text",
		Description: "Cloud-based transcription using FPT AI's ASR engine, optimized for Vietnamese",
		Version:     "v1",
		SupportedLanguages: []string{"vi", "en"},
		SupportedFormats:  []string{"mp3", "wav", "m4a", "flac"},
		RequiresGPU:       false,
		MemoryRequirement: 0, // Cloud-based
		Features: map[string]bool{
			"timestamps":         false, 
			"word_level":         false,
			"diarization":        false,
			"translation":        false,
			"language_detection": false,
		},
		Metadata: map[string]string{
			"provider": "fpt",
			"api_url":  "https://api.fpt.ai/hmi/asr/general",
		},
	}

	schema := []interfaces.ParameterSchema{
		{
			Name:        "api_key",
			Type:        "string",
			Required:    false,
			Description: "FPT AI API Key",
			Group:       "authentication",
		},
	}

	baseAdapter := NewBaseAdapter("fpt_ai", "", capabilities, schema)

	return &FPTAdapter{
		BaseAdapter: baseAdapter,
		apiKey:      apiKey,
	}
}

// GetSupportedModels returns supported models (internal IDs)
func (a *FPTAdapter) GetSupportedModels() []string {
	return []string{"general"}
}

// PrepareEnvironment is a no-op
func (a *FPTAdapter) PrepareEnvironment(ctx context.Context) error {
	// Need to access the initialized field of BaseAdapter directly or via method if possible.
	// BaseAdapter struct field 'initialized' is unexported (lower case).
	// But BaseAdapter provides no setter for it?
	// Wait, NewBaseAdapter sets initialized=false.
	// PrepareEnvironment in BaseAdapter sets initialized=true.
	// If I override it, I must ensure IsReady returns true.
	// BaseAdapter.IsReady checks b.initialized.
	// Since I cannot set a.initialized (private in other package), I should call a.BaseAdapter.PrepareEnvironment(ctx)
	// But BaseAdapter.PrepareEnvironment expects modelPath to be valid if set. We passed "".
	return a.BaseAdapter.PrepareEnvironment(ctx)
}

// Transcribe processes audio using FPT AI API
func (a *FPTAdapter) Transcribe(ctx context.Context, input interfaces.AudioInput, params map[string]interface{}, procCtx interfaces.ProcessingContext) (*interfaces.TranscriptResult, error) {
	startTime := time.Now()
	a.LogProcessingStart(input, procCtx)
	// defer logging handle error explicitly or use a variable
	var err error
	defer func() {
		a.LogProcessingEnd(procCtx, time.Since(startTime), err)
	}()

	// Get API Key from params or adapter default
	apiKey := a.apiKey
	if key, ok := params["api_key"].(string); ok && key != "" {
		apiKey = key
	}

	if apiKey == "" {
		err = fmt.Errorf("FPT AI API key is required but not provided")
		return nil, err
	}

	// Prepare request
	file, errOpen := os.Open(input.FilePath)
	if errOpen != nil {
		err = fmt.Errorf("failed to open audio file: %w", errOpen)
		return nil, err
	}
	defer file.Close()

	body := &bytes.Buffer{}
	_, errCopy := io.Copy(body, file)
	if errCopy != nil {
		err = fmt.Errorf("failed to read audio file: %w", errCopy)
		return nil, err
	}

	req, errReq := http.NewRequestWithContext(ctx, "POST", "https://api.fpt.ai/hmi/asr/general", body)
	if errReq != nil {
		err = fmt.Errorf("failed to create request: %w", errReq)
		return nil, err
	}

	req.Header.Set("api_key", apiKey)
	req.Header.Set("Content-Type", "application/octet-stream")

	client := &http.Client{Timeout: 5 * time.Minute}
	resp, errDo := client.Do(req)
	if errDo != nil {
		err = fmt.Errorf("request to FPT AI failed: %w", errDo)
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		err = fmt.Errorf("FPT AI error (status %d): %s", resp.StatusCode, string(respBody))
		return nil, err
	}

	respBody, _ := io.ReadAll(resp.Body)
	fmt.Printf(">>> FPT_RAW: %s\n", string(respBody))
	
	var fptResponse struct {
		Status     int    `json:"status"`
		Hypotheses []struct {
			Transcript string `json:"transcript"`
		} `json:"hypotheses"`
		ID string `json:"id"`
	}

	if errDecode := json.Unmarshal(respBody, &fptResponse); errDecode != nil {
		fmt.Printf(">>> FPT_ERROR: Decode failed %v\n", errDecode)
		return nil, fmt.Errorf("failed to decode FPT AI response: %w", errDecode)
	}

	transcript := ""
	if len(fptResponse.Hypotheses) > 0 {
		transcript = fptResponse.Hypotheses[0].Transcript
	}
	fmt.Printf(">>> FPT_RESULT: '%s' (Status: %d)\n", transcript, fptResponse.Status)

	result := &interfaces.TranscriptResult{
		Text:           transcript,
		Language:       "vi",
		ProcessingTime: time.Since(startTime),
		ModelUsed:      "fpt_ai_general",
		Segments: []interfaces.TranscriptSegment{
			{
				Start: 0,
				End:   input.Duration.Seconds(),
				Text:  transcript,
			},
		},
		Metadata: a.CreateDefaultMetadata(params),
	}

	return result, nil
}
