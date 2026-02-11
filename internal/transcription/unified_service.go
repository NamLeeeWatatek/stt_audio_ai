package transcription

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"scriberr/internal/llm"
	"scriberr/internal/models"
	"scriberr/internal/repository"
	"scriberr/internal/sse"
	"scriberr/internal/transcription/interfaces"
	"scriberr/internal/transcription/pipeline"
	"scriberr/internal/transcription/registry"
	"scriberr/internal/webhook"
	"scriberr/pkg/logger"
)

const (
	ModelWhisperX        = "whisperx"
	ModelPyannote        = "pyannote"
	ModelParakeet        = "parakeet"
	ModelCanary          = "canary"
	ModelSortformer      = "sortformer"
	ModelOpenAI          = "openai_whisper"
	ModelGroq            = "groq_whisper"
	ModelVoxtral         = "voxtral"
	ModelFPT             = "fpt_ai"
	ModelDiarization31   = "pyannote/speaker-diarization-3.1"
	FamilyNvidiaCanary   = "nvidia_canary"
	FamilyNvidiaParakeet = "nvidia_parakeet"
	FamilyWhisper        = "whisper"
	FamilyOpenAI         = "openai"
	FamilyGroq           = "groq"
	FamilyMistralVoxtral = "mistral_voxtral"
	DiarizeSortformer    = "nvidia_sortformer"
	FamilyFPT            = "fpt"
	OutputFormatJSON     = "json"
)

// UnifiedTranscriptionService provides a unified interface for all transcription and diarization models
type UnifiedTranscriptionService struct {
	registry              *registry.ModelRegistry
	pipeline              *pipeline.ProcessingPipeline
	preprocessors         map[string]interfaces.Preprocessor
	postprocessors        map[string]interfaces.Postprocessor
	tempDirectory         string
	outputDirectory       string
	defaultModelIDs       map[string]string      // Default model IDs for each task type
	multiTrackTranscriber *MultiTrackTranscriber // For termination support
	jobRepo               repository.JobRepository
	webhookService        *webhook.Service
	broadcaster           *sse.Broadcaster
	llmService            llm.Service
}

// NewUnifiedTranscriptionService creates a new unified transcription service
func NewUnifiedTranscriptionService(jobRepo repository.JobRepository, tempDir, outputDir string) *UnifiedTranscriptionService {
	return &UnifiedTranscriptionService{
		registry:        registry.GetRegistry(),
		pipeline:        pipeline.NewProcessingPipeline(),
		preprocessors:   make(map[string]interfaces.Preprocessor),
		postprocessors:  make(map[string]interfaces.Postprocessor),
		tempDirectory:   tempDir,
		outputDirectory: outputDir,
		defaultModelIDs: map[string]string{
			"transcription": ModelFPT,
			"diarization":   ModelPyannote,
		},
		jobRepo:        jobRepo,
		webhookService: webhook.NewService(),
	}
}

// SetBroadcaster sets the SSE broadcaster for the service
func (u *UnifiedTranscriptionService) SetBroadcaster(b *sse.Broadcaster) {
	u.broadcaster = b
}

// SetLLMService sets the LLM service for smart analysis
func (u *UnifiedTranscriptionService) SetLLMService(s llm.Service) {
	u.llmService = s
}

// Initialize prepares all registered models for use
func (u *UnifiedTranscriptionService) Initialize(ctx context.Context) error {
	logger.Info("Initializing unified transcription service")

	// Create necessary directories
	if err := os.MkdirAll(u.tempDirectory, 0755); err != nil {
		return fmt.Errorf("failed to create temp directory: %w", err)
	}
	if err := os.MkdirAll(u.outputDirectory, 0755); err != nil {
		return fmt.Errorf("failed to create output directory: %w", err)
	}

	// Initialize all registered models
	if err := u.registry.InitializeModels(ctx); err != nil {
		return fmt.Errorf("failed to initialize models: %w", err)
	}

	logger.Info("Unified transcription service initialized successfully")
	return nil
}

// ProcessJob processes a transcription job using the new adapter architecture
//
//nolint:gocyclo // Complex orchestration required
func (u *UnifiedTranscriptionService) ProcessJob(ctx context.Context, jobID string) error {
	startTime := time.Now()
	logger.Info("Processing job with unified service", "job_id", jobID)

	// Get the job from database
	// Get the job from database
	job, err := u.jobRepo.FindWithAssociations(ctx, jobID)
	if err != nil {
		return fmt.Errorf("failed to get job: %w", err)
	}

	// Create execution record
	execution := &models.TranscriptionJobExecution{
		TranscriptionJobID: jobID,
		StartedAt:          startTime,
		ActualParameters:   job.Parameters,
		Status:             models.StatusProcessing,
	}

	if err := u.jobRepo.CreateExecution(ctx, execution); err != nil {
		return fmt.Errorf("failed to create execution record: %w", err)
	}

	// Broadcast initial processing status
	if u.broadcaster != nil {
		u.broadcaster.Broadcast(jobID, "job_update", map[string]interface{}{
			"job_id": jobID,
			"status": models.StatusProcessing,
		})
	}

	// Helper function to update execution status
	updateExecutionStatus := func(status models.JobStatus, errorMsg string) {
		completedAt := time.Now()
		execution.CompletedAt = &completedAt
		execution.Status = status
		execution.CalculateProcessingDuration()

		if errorMsg != "" {
			execution.ErrorMessage = &errorMsg
		}

		_ = u.jobRepo.UpdateExecution(ctx, execution)

		// Broadcast update via SSE
		if u.broadcaster != nil {
			u.broadcaster.Broadcast(jobID, "job_update", map[string]interface{}{
				"job_id": jobID,
				"status": status,
				"error":  errorMsg,
			})
		}

		// Trigger webhook if callback URL is present
		if job.Parameters.CallbackURL != nil && *job.Parameters.CallbackURL != "" {
			payload := webhook.WebhookPayload{
				JobID:        job.ID,
				Status:       status,
				AudioPath:    job.AudioPath,
				Transcript:   job.Transcript,
				Summary:      job.Summary,
				ErrorMessage: execution.ErrorMessage,
				CompletedAt:  completedAt,
				Metadata: map[string]interface{}{
					"model":        job.Parameters.Model,
					"model_family": job.Parameters.ModelFamily,
					"duration_ms":  execution.ProcessingDuration,
				},
			}

			// Send webhook asynchronously to not block the main process
			go func() {
				// Create a new context with timeout for the webhook
				webhookCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				defer cancel()

				if err := u.webhookService.SendWebhook(webhookCtx, *job.Parameters.CallbackURL, payload); err != nil {
					logger.Error("Failed to send webhook", "job_id", job.ID, "error", err)
				}
			}()
		}
	}

	// Check for multi-track processing
	if job.IsMultiTrack && job.Parameters.IsMultiTrackEnabled {
		logger.Info("Processing multi-track job", "job_id", jobID)
		if err := u.processMultiTrackJob(ctx, job); err != nil {
			errMsg := fmt.Sprintf("multi-track processing failed: %v", err)
			updateExecutionStatus(models.StatusFailed, errMsg)
			return fmt.Errorf("%s", errMsg)
		}
	} else {
		// Process single track
		if err := u.processSingleTrackJob(ctx, job); err != nil {
			errMsg := fmt.Sprintf("single-track processing failed: %v", err)
			updateExecutionStatus(models.StatusFailed, errMsg)
			return fmt.Errorf("%s", errMsg)
		}
	}

	// Success
	updateExecutionStatus(models.StatusCompleted, "")
	logger.Info("Job processed successfully", "job_id", jobID, "duration", time.Since(startTime))
	return nil
}

// processSingleTrackJob handles single audio file transcription
//
//nolint:gocyclo // Orchestrator function with multiple steps
func (u *UnifiedTranscriptionService) processSingleTrackJob(ctx context.Context, job *models.TranscriptionJob) error {
	logger.Info("Processing single-track job", "job_id", job.ID, "model_family", job.Parameters.ModelFamily)

	// Create processing context
	procCtx := interfaces.ProcessingContext{
		JobID:           job.ID,
		OutputDirectory: filepath.Join(u.outputDirectory, job.ID),
		TempDirectory:   u.tempDirectory,
		Metadata:        map[string]string{},
	}

	// Create output directory
	if err := os.MkdirAll(procCtx.OutputDirectory, 0755); err != nil {
		return fmt.Errorf("failed to create output directory: %w", err)
	}

	// -------------------------------------------------------------------------
	// REMEDIATION: Fix WebM Metadata (Duration) for Frontend Player Compatibility
	// -------------------------------------------------------------------------
	if strings.HasSuffix(strings.ToLower(job.AudioPath), ".webm") {
		logger.Info("Attempting to fix WebM container metadata", "file", job.AudioPath)
		fixedPath := strings.TrimSuffix(job.AudioPath, ".webm") + "_fixed.webm"

		// ffmpeg -i input.webm -c copy output_fixed.webm
		// This forces ffmpeg to rewrite the container, adding the missing Duration header
		cmd := exec.Command("ffmpeg", "-y", "-i", job.AudioPath, "-c", "copy", fixedPath)
		if output, err := cmd.CombinedOutput(); err != nil {
			logger.Warn("Failed to fix WebM metadata, proceeding with original", "error", err, "output", string(output))
		} else {
			// Check if file exists and has size
			if info, err := os.Stat(fixedPath); err == nil && info.Size() > 0 {
				logger.Info("WebM metadata fixed successfully", "new_path", fixedPath)
				
				// Update job record with new path
				if err := u.jobRepo.UpdateAudioPath(ctx, job.ID, fixedPath); err != nil {
					logger.Error("Failed to update job audio path in DB", "error", err)
					// Proceed with original if DB update fails (or fixed one? let's stick to original references if DB mismatch)
				} else {
					// Use fixed path for processing
					job.AudioPath = fixedPath
					
					// Optional: Remove original if strictly necessary, but keeping it for safety for now
					// os.Remove(originalPath) 
				}
			}
		}
	}
	// -------------------------------------------------------------------------

	// Create audio input
	audioInput, err := u.createAudioInput(job.AudioPath)
	if err != nil {
		return fmt.Errorf("failed to create audio input: %w", err)
	}

	// Determine models to use first
	transcriptionModelID, diarizationModelID, err := u.selectModels(job.Parameters)
	if err != nil {
		return fmt.Errorf("failed to select models: %w", err)
	}

	// Apply preprocessing to ensure audio is in correct format (mono 16kHz)
	var preprocessedInput interfaces.AudioInput
	var tempFilesToCleanup []string

	// Get model capabilities for preprocessing decisions
	var capabilities interfaces.ModelCapabilities
	if transcriptionModelID != "" {
		if adapter, err := u.registry.GetTranscriptionAdapter(transcriptionModelID); err == nil {
			capabilities = adapter.GetCapabilities()
		}
	} else if diarizationModelID != "" {
		if adapter, err := u.registry.GetDiarizationAdapter(diarizationModelID); err == nil {
			capabilities = adapter.GetCapabilities()
		}
	}

	// Apply preprocessing
	preprocessedInput, err = u.pipeline.ProcessAudio(ctx, audioInput, capabilities)
	if err != nil {
		logger.Warn("Audio preprocessing failed, using original", "error", err)
		preprocessedInput = audioInput
	} else {
		// Track temporary file for cleanup if preprocessing created one
		if preprocessedInput.TempFilePath != "" && preprocessedInput.TempFilePath != audioInput.FilePath {
			tempFilesToCleanup = append(tempFilesToCleanup, preprocessedInput.TempFilePath)
			logger.Info("Audio preprocessing completed",
				"original", audioInput.FilePath,
				"converted", preprocessedInput.TempFilePath,
				"original_sr", audioInput.SampleRate,
				"converted_sr", preprocessedInput.SampleRate,
				"original_channels", audioInput.Channels,
				"converted_channels", preprocessedInput.Channels)
		}
	}

	// Ensure cleanup of temporary files when function exits
	defer func() {
		for _, tempFile := range tempFilesToCleanup {
			if err := os.Remove(tempFile); err != nil {
				logger.Warn("Failed to clean up temporary file", "file", tempFile, "error", err)
			} else {
				logger.Info("Cleaned up temporary file", "file", tempFile)
			}
		}
	}()

	var transcriptResult *interfaces.TranscriptResult
	var diarizationResult *interfaces.DiarizationResult

	// Perform transcription using the preprocessed audio
	if transcriptionModelID != "" {
		logger.Info("Running transcription", "model_id", transcriptionModelID)
		transcriptionAdapter, err := u.registry.GetTranscriptionAdapter(transcriptionModelID)
		if err != nil {
			return fmt.Errorf("failed to get transcription adapter: %w", err)
		}

		// Convert parameters for this specific model
		params := u.convertParametersForModel(job.Parameters, transcriptionModelID)

		transcriptResult, err = transcriptionAdapter.Transcribe(ctx, preprocessedInput, params, procCtx)
		if err != nil {
			return fmt.Errorf("transcription failed: %w", err)
		}
	}

	// Perform diarization if requested and not already done by transcription
	if job.Parameters.Diarize && diarizationModelID != "" {
		// Convert parameters for diarization model
		diarizationParams := u.convertParametersForModel(job.Parameters, diarizationModelID)

		if !u.transcriptionIncludesDiarization(transcriptionModelID, job.Parameters) {
			logger.Info("Running separate diarization", "model_id", diarizationModelID)
			diarizationAdapter, err := u.registry.GetDiarizationAdapter(diarizationModelID)
			if err != nil {
				logger.Warn("Diarization adapter not found, skipping diarization step", "error", err)
			} else if !diarizationAdapter.IsReady(ctx) {
				logger.Warn("Diarization adapter is not ready (missing dependencies), skipping diarization step", "model_id", diarizationModelID)
			} else {
				// Use the same preprocessed audio for diarization
				diarizationResult, err = diarizationAdapter.Diarize(ctx, preprocessedInput, diarizationParams, procCtx)
				if err != nil {
					logger.Warn("Diarization failed, proceeding with transcription only", "error", err)
				}

				// Merge diarization results with transcription
				if transcriptResult != nil && diarizationResult != nil {
					transcriptResult = u.mergeDiarizationWithTranscription(transcriptResult, diarizationResult)
				}
			}
		}
	}

	// Apply smart analysis using LLM if available and suitable
	if u.llmService != nil && transcriptResult != nil {
		logger.Info("Applying smart analysis for speaker/role identification")
		title := "Untitled"
		if job.Title != nil {
			title = *job.Title
		}
		if err := u.ApplySmartAnalysis(ctx, title, job.ID, transcriptResult); err != nil {
			logger.Warn("Smart analysis failed, proceeding with raw transcript", "error", err)
		}
	}

	// Save results to database
	if transcriptResult != nil {
		if err := u.saveTranscriptionResults(job.ID, transcriptResult); err != nil {
			return fmt.Errorf("failed to save transcription results: %w", err)
		}
	}

	return nil
}

// processMultiTrackJob handles multi-track audio processing
func (u *UnifiedTranscriptionService) processMultiTrackJob(ctx context.Context, job *models.TranscriptionJob) error {
	logger.Info("Processing multi-track job", "job_id", job.ID, "track_count", len(job.MultiTrackFiles))

	// Create unified processor for this service
	unifiedProcessor := &UnifiedJobProcessor{
		unifiedService: u,
	}

	// Create multi-track transcriber with unified processor and store reference for termination
	transcriber := NewMultiTrackTranscriber(unifiedProcessor)
	u.multiTrackTranscriber = transcriber

	// Process the multi-track transcription
	return transcriber.ProcessMultiTrackTranscription(ctx, job.ID)
}

// TerminateMultiTrackJob terminates a multi-track job and all its individual track jobs
func (u *UnifiedTranscriptionService) TerminateMultiTrackJob(jobID string) error {
	if u.multiTrackTranscriber == nil {
		return fmt.Errorf("no multi-track transcriber available")
	}
	return u.multiTrackTranscriber.TerminateMultiTrackJob(jobID)
}

// IsMultiTrackJob checks if a job is a multi-track job
func (u *UnifiedTranscriptionService) IsMultiTrackJob(jobID string) bool {
	// Simple check provided it's being tracked
	return u.multiTrackTranscriber != nil && u.multiTrackTranscriber.IsJobMultiTrack(jobID)
}

// ApplySmartAnalysis uses LLM to identify speakers and roles from the transcript
func (u *UnifiedTranscriptionService) ApplySmartAnalysis(ctx context.Context, jobTitle string, jobID string, result *interfaces.TranscriptResult) error {
	if u.llmService == nil {
		return fmt.Errorf("LLM service not configured")
	}

	// 1. Prepare segments for the LLM
	var promptBuilder strings.Builder
	promptBuilder.WriteString(fmt.Sprintf("Meeting/Recording Title: %s\n", jobTitle))
	promptBuilder.WriteString("Act as a professional Meeting Secretary. Your task is to proofread and structure the raw transcript segments below.\n")
	promptBuilder.WriteString("1. **Speaker Identification**: Assign consistent speaker labels (e.g., 'Speaker 1', 'Speaker 2'). If a speaker is unclear, infer from context or carry over the previous speaker. Ensure NO segment is left without a speaker.\n")
	promptBuilder.WriteString("2. **Proofreading**: Fix spelling errors, typos (e.g., 'phép tạp' -> 'phức tạp'), and grammatical issues in the Vietnamese text while preserving the original meaning and tone.\n")
	promptBuilder.WriteString("3. **Formatting**: Ensure text is capitalized and punctuated correctly.\n")
	promptBuilder.WriteString("4. **Summary**: Provide a concise meeting summary.\n\n")
	
	promptBuilder.WriteString("Return STRICTLY a JSON object with this structure:\n")
	promptBuilder.WriteString("{\n")
	promptBuilder.WriteString("  \"segments\": {\n")
	promptBuilder.WriteString("    \"0\": { \"speaker\": \"Speaker 1\", \"text\": \"Corrected text for segment 0\" },\n")
	promptBuilder.WriteString("    \"1\": { \"speaker\": \"Speaker 1\", \"text\": \"Corrected text for segment 1\" }\n")
	promptBuilder.WriteString("  },\n")
	promptBuilder.WriteString("  \"summary\": \"The meeting discussed...\"\n")
	promptBuilder.WriteString("}\n\n")
	promptBuilder.WriteString("Raw Segments:\n")

	// Limit to first 500 segments to avoid context overflow for very long meetings
	maxSegments := 500
	if len(result.Segments) < maxSegments {
		maxSegments = len(result.Segments)
	}

	for i := 0; i < maxSegments; i++ {
		seg := result.Segments[i]
		promptBuilder.WriteString(fmt.Sprintf("[%d] %s\n", i, seg.Text))
	}

	promptBuilder.WriteString("\nJSON Output:")

	// 2. Call LLM
	messages := []llm.ChatMessage{
		{Role: "system", Content: "You are an expert transcriber and secretary. You output valid JSON only. You fix typos and assign speakers accurately."},
		{Role: "user", Content: promptBuilder.String()},
	}

	// Use Llama 3.3 70B for best reasoning capability
	model := "llama-3.3-70b-versatile"
	
	logger.Info("Sending transcript to LLM for secretary-level analysis", "segments", maxSegments)
	resp, err := u.llmService.ChatCompletion(ctx, model, messages, 0.1)
	if err != nil {
		return fmt.Errorf("LLM request failed: %w", err)
	}

	if len(resp.Choices) == 0 {
		return fmt.Errorf("empty LLM response")
	}

	content := resp.Choices[0].Message.Content

	// 3. Parse JSON response
	// Find JSON block if wrapped in markdown
	start := strings.Index(content, "{")
	end := strings.LastIndex(content, "}")
	if start != -1 && end != -1 {
		content = content[start : end+1]
	}

	var analysisResult struct {
		Segments map[string]struct {
			Speaker string `json:"speaker"`
			Text    string `json:"text"`
		} `json:"segments"`
		Summary string `json:"summary"`
	}

	if err := json.Unmarshal([]byte(content), &analysisResult); err != nil {
		logger.Error("Failed to parse LLM JSON", "content", content, "error", err)
		return nil // Non-fatal
	}

	// 4. Update Transcript Segments with Secretary Updates
	updatedCount := 0
	for idxStr, data := range analysisResult.Segments {
		idx, err := strconv.Atoi(idxStr)
		if err == nil && idx >= 0 && idx < len(result.Segments) {
			// Update text if provided (correct typos)
			if data.Text != "" {
				result.Segments[idx].Text = data.Text
			}
			// Update speaker if provided (ensure no nulls)
			if data.Speaker != "" {
				spk := data.Speaker
				result.Segments[idx].Speaker = &spk
			}
			updatedCount++
		}
	}
	logger.Info("Applied secretary updates to transcript", "updated_segments", updatedCount)

	// 5. Update Job Summary
	if analysisResult.Summary != "" {
		if err := u.jobRepo.UpdateSummary(ctx, jobID, analysisResult.Summary); err != nil {
			logger.Warn("Failed to save meeting summary", "error", err)
		} else {
			logger.Info("Meeting summary saved", "length", len(analysisResult.Summary))
		}
	}

	logger.Info("Smart analysis complete", "segments_updated", updatedCount)
	return nil
}



// selectModels determines which models to use based on job parameters
func (u *UnifiedTranscriptionService) selectModels(params models.WhisperXParams) (transcriptionModelID, diarizationModelID string, err error) {
	// Determine transcription model
	switch params.ModelFamily {
	case FamilyNvidiaParakeet:
		transcriptionModelID = ModelParakeet
	case FamilyNvidiaCanary:
		transcriptionModelID = ModelCanary
	case FamilyWhisper:
		transcriptionModelID = ModelGroq // Override local Whisper to use Groq
	case FamilyOpenAI:
		transcriptionModelID = ModelOpenAI
	case FamilyGroq:
		transcriptionModelID = ModelGroq
	case FamilyMistralVoxtral:
		transcriptionModelID = ModelVoxtral
	case FamilyFPT:
		transcriptionModelID = ModelFPT
	default:
		transcriptionModelID = ModelFPT // Default to FPT for better VN support
	}

	// Determine diarization model if needed
	// NOTE: Local diarization (PyAnnote) is disabled in slim Docker image
	// Determine diarization model if needed
	if params.Diarize {
		// If the transcription model handles diarization natively (like WhisperX), we don't need a separate ID
		if u.transcriptionIncludesDiarization(transcriptionModelID, params) {
			diarizationModelID = "" // Managed by transcription adapter
		} else {
			// For models that don't support it natively (Groq, OpenAI), use Pyannote
			diarizationModelID = ModelPyannote
		}
	}
	
	logger.Info("Selected models",
		"transcription", transcriptionModelID,
		"diarization", diarizationModelID,
		"original_family", params.ModelFamily,
		"original_diarize_model", params.DiarizeModel)

	return transcriptionModelID, diarizationModelID, nil
}

// transcriptionIncludesDiarization checks if the transcription model already includes diarization
func (u *UnifiedTranscriptionService) transcriptionIncludesDiarization(modelID string, params models.WhisperXParams) bool {
	// WhisperX includes diarization when enabled
	// WhisperX includes diarization when enabled
	if modelID == ModelWhisperX {
		if params.Diarize {
			// Check if it's using nvidia_sortformer (which requires separate processing)
			if params.DiarizeModel == DiarizeSortformer {
				return false
			}
			return true
		}
	}

	return false
}

// ffprobeOutput represents the JSON output from ffprobe
type ffprobeOutput struct {
	Streams []struct {
		CodecType  string `json:"codec_type"`
		SampleRate string `json:"sample_rate"`
		Channels   int    `json:"channels"`
		Duration   string `json:"duration"`
		CodecName  string `json:"codec_name"`
		BitRate    string `json:"bit_rate"`
	} `json:"streams"`
	Format struct {
		Duration string `json:"duration"`
		Size     string `json:"size"`
	} `json:"format"`
}

// createAudioInput creates an AudioInput from a file path with real metadata
func (u *UnifiedTranscriptionService) createAudioInput(audioPath string) (interfaces.AudioInput, error) {
	// Get file info
	fileInfo, err := os.Stat(audioPath)
	if err != nil {
		return interfaces.AudioInput{}, fmt.Errorf("failed to stat audio file: %w", err)
	}

	// Determine format from extension
	ext := strings.ToLower(filepath.Ext(audioPath))
	format := strings.TrimPrefix(ext, ".")

	// Use ffprobe to get actual audio metadata
	audioInput := interfaces.AudioInput{
		FilePath: audioPath,
		Format:   format,
		Size:     fileInfo.Size(),
		Metadata: map[string]string{},
	}

	// Run ffprobe to get audio metadata
	cmd := exec.Command("ffprobe",
		"-v", "quiet",
		"-print_format", "json",
		"-show_format",
		"-show_streams",
		audioPath)

	output, err := cmd.Output()
	if err != nil {
		logger.Warn("Failed to run ffprobe, using defaults", "error", err, "file", audioPath)
		// Fallback to defaults
		audioInput.SampleRate = 16000
		audioInput.Channels = 1
		audioInput.Duration = time.Duration(float64(fileInfo.Size()/32000)) * time.Second
		return audioInput, nil
	}

	// Parse ffprobe output
	var probeData ffprobeOutput
	if err := json.Unmarshal(output, &probeData); err != nil {
		logger.Warn("Failed to parse ffprobe output, using defaults", "error", err)
		audioInput.SampleRate = 16000
		audioInput.Channels = 1
		audioInput.Duration = time.Duration(float64(fileInfo.Size()/32000)) * time.Second
		return audioInput, nil
	}

	// Find the audio stream
	for _, stream := range probeData.Streams {
		if stream.CodecType == "audio" {
			// Parse sample rate
			if sampleRate, err := strconv.Atoi(stream.SampleRate); err == nil {
				audioInput.SampleRate = sampleRate
			} else {
				audioInput.SampleRate = 16000 // Default
			}

			// Set channels
			audioInput.Channels = stream.Channels
			if audioInput.Channels == 0 {
				audioInput.Channels = 1 // Default to mono
			}

			// Parse duration
			if duration, err := strconv.ParseFloat(stream.Duration, 64); err == nil {
				audioInput.Duration = time.Duration(duration * float64(time.Second))
			} else if duration, err := strconv.ParseFloat(probeData.Format.Duration, 64); err == nil {
				audioInput.Duration = time.Duration(duration * float64(time.Second))
			} else {
				// Fallback calculation
				audioInput.Duration = time.Duration(float64(fileInfo.Size()/32000)) * time.Second
			}

			// Store additional metadata
			audioInput.Metadata["codec"] = stream.CodecName
			if stream.BitRate != "" {
				audioInput.Metadata["bitrate"] = stream.BitRate
			}

			break
		}
	}

	// Set defaults if no audio stream found
	if audioInput.SampleRate == 0 {
		audioInput.SampleRate = 16000
	}
	if audioInput.Channels == 0 {
		audioInput.Channels = 1
	}

	logger.Info("Audio metadata extracted",
		"file", audioPath,
		"sample_rate", audioInput.SampleRate,
		"channels", audioInput.Channels,
		"duration", audioInput.Duration,
		"size", audioInput.Size)

	return audioInput, nil
}

// parametersToMap converts WhisperXParams to a generic parameter map
// convertParametersForModel converts WhisperX parameters to model-specific parameters
func (u *UnifiedTranscriptionService) convertParametersForModel(params models.WhisperXParams, modelID string) map[string]interface{} {
	switch modelID {
	case ModelParakeet:
		return u.convertToParakeetParams(params)
	case ModelCanary:
		return u.convertToCanaryParams(params)
	case ModelWhisperX:
		return u.convertToWhisperXParams(params)
	case ModelPyannote:
		return u.convertToPyannoteParams(params)
	case ModelSortformer:
		return u.convertToSortformerParams(params)
	case ModelOpenAI:
		return u.convertToOpenAIParams(params)
	case ModelGroq:
		return u.convertToGroqParams(params)
	case ModelVoxtral:
		return u.convertToVoxtralParams(params)
	default:
		// Fallback to legacy conversion
		return u.parametersToMap(params)
	}
}

// convertToGroqParams converts to Groq-specific parameters
func (u *UnifiedTranscriptionService) convertToGroqParams(params models.WhisperXParams) map[string]interface{} {
	paramMap := map[string]interface{}{
		"model":       params.Model,
		"temperature": params.Temperature,
	}

	// Use Groq default model if not specified or generically named
	// This maps local whisper model names (base, small, medium, large-vX) to generic Groq model
	if params.Model == "" || !strings.Contains(params.Model, "whisper-large") {
		paramMap["model"] = "whisper-large-v3"
	}

	if params.Language != nil {
		paramMap["language"] = *params.Language
	}
	if params.InitialPrompt != nil {
		paramMap["prompt"] = *params.InitialPrompt
	}

	// Add API key if provided in params
	if params.APIKey != nil && *params.APIKey != "" {
		paramMap["api_key"] = *params.APIKey
	}

	return paramMap
}

// convertToOpenAIParams converts to OpenAI-specific parameters
func (u *UnifiedTranscriptionService) convertToOpenAIParams(params models.WhisperXParams) map[string]interface{} {
	paramMap := map[string]interface{}{
		"model":       params.Model,
		"temperature": params.Temperature,
	}

	if params.Language != nil {
		paramMap["language"] = *params.Language
	}
	if params.InitialPrompt != nil {
		paramMap["prompt"] = *params.InitialPrompt
	}

	// Add API key if provided in params (e.g. from UI override)
	if params.APIKey != nil && *params.APIKey != "" {
		paramMap["api_key"] = *params.APIKey
	}

	return paramMap
}

// convertToVoxtralParams converts to Voxtral-specific parameters
func (u *UnifiedTranscriptionService) convertToVoxtralParams(params models.WhisperXParams) map[string]interface{} {
	paramMap := map[string]interface{}{}

	// Language
	if params.Language != nil {
		paramMap["language"] = *params.Language
	} else {
		paramMap["language"] = "en"
	}

	// Max new tokens
	if params.MaxNewTokens != nil {
		paramMap["max_new_tokens"] = *params.MaxNewTokens
	}

	return paramMap
}

// convertToParakeetParams converts to Parakeet-specific parameters
func (u *UnifiedTranscriptionService) convertToParakeetParams(params models.WhisperXParams) map[string]interface{} {
	return map[string]interface{}{
		"timestamps":         true,
		"context_left":       params.AttentionContextLeft,
		"context_right":      params.AttentionContextRight,
		"output_format":      OutputFormatJSON,
		"auto_convert_audio": true,
	}
}

// convertToCanaryParams converts to Canary-specific parameters
func (u *UnifiedTranscriptionService) convertToCanaryParams(params models.WhisperXParams) map[string]interface{} {
	paramMap := map[string]interface{}{
		"timestamps":         true,
		"output_format":      OutputFormatJSON,
		"auto_convert_audio": true,
		"task":               params.Task,
	}

	// Set source language
	if params.Language != nil {
		paramMap["source_lang"] = *params.Language
	} else {
		paramMap["source_lang"] = "en"
	}

	// Set target language for translation
	if params.Task == "translate" {
		paramMap["target_lang"] = "en"
	}

	return paramMap
}

// convertToWhisperXParams converts to WhisperX-specific parameters
func (u *UnifiedTranscriptionService) convertToWhisperXParams(params models.WhisperXParams) map[string]interface{} {
	// For WhisperX, we use the standard WhisperX parameters (no NVIDIA-specific ones)
	paramMap := map[string]interface{}{
		// Core parameters
		"model":        params.Model,
		"device":       params.Device,
		"device_index": params.DeviceIndex,
		"batch_size":   params.BatchSize,
		"compute_type": params.ComputeType,
		"threads":      params.Threads,

		// Task and language
		"task": params.Task,

		// Diarization
		"diarize":       params.Diarize,
		"diarize_model": params.DiarizeModel,

		// Quality settings
		"temperature": params.Temperature,
		"best_of":     params.BestOf,
		"beam_size":   params.BeamSize,
		"patience":    params.Patience,

		// VAD settings
		"vad_method": params.VadMethod,
		"vad_onset":  params.VadOnset,
		"vad_offset": params.VadOffset,
	}

	// Handle pointer fields - only add if not nil
	if params.Language != nil {
		paramMap["language"] = *params.Language
	}
	if params.MinSpeakers != nil {
		paramMap["min_speakers"] = *params.MinSpeakers
	}
	if params.MaxSpeakers != nil {
		paramMap["max_speakers"] = *params.MaxSpeakers
	}
	if params.HfToken != nil {
		paramMap["hf_token"] = *params.HfToken
	}
	if params.ModelDir != nil {
		paramMap["model_dir"] = *params.ModelDir
	}
	if params.AlignModel != nil {
		paramMap["align_model"] = *params.AlignModel
	}
	if params.SuppressTokens != nil {
		paramMap["suppress_tokens"] = *params.SuppressTokens
	}
	if params.InitialPrompt != nil {
		paramMap["initial_prompt"] = *params.InitialPrompt
	}

	return paramMap
}

// convertToPyannoteParams converts to PyAnnote-specific parameters
func (u *UnifiedTranscriptionService) convertToPyannoteParams(params models.WhisperXParams) map[string]interface{} {
	paramMap := map[string]interface{}{
		"output_format":      OutputFormatJSON,
		"auto_convert_audio": true,
		"device":             "auto",
	}

	if params.MinSpeakers != nil {
		paramMap["min_speakers"] = *params.MinSpeakers
	}
	if params.MaxSpeakers != nil {
		paramMap["max_speakers"] = *params.MaxSpeakers
	}
	if params.HfToken != nil {
		paramMap["hf_token"] = *params.HfToken
	}

	// Map VAD thresholds to Pyannote segmentation parameters
	// These control voice activity detection sensitivity for diarization
	if params.VadOnset > 0 {
		paramMap["segmentation_onset"] = params.VadOnset
	}
	if params.VadOffset > 0 {
		paramMap["segmentation_offset"] = params.VadOffset
	}

	return paramMap
}

// convertToSortformerParams converts to Sortformer-specific parameters
func (u *UnifiedTranscriptionService) convertToSortformerParams(params models.WhisperXParams) map[string]interface{} {
	return map[string]interface{}{
		"output_format":      OutputFormatJSON,
		"auto_convert_audio": true,
		// Sortformer is optimized for 4 speakers, no additional config needed
	}
}

func (u *UnifiedTranscriptionService) parametersToMap(params models.WhisperXParams) map[string]interface{} {
	paramMap := map[string]interface{}{
		// Core parameters
		"model":        params.Model,
		"device":       params.Device,
		"device_index": params.DeviceIndex,
		"batch_size":   params.BatchSize,
		"compute_type": params.ComputeType,
		"threads":      params.Threads,

		// Language and task
		"task": params.Task,

		// Diarization
		"diarize":       params.Diarize,
		"diarize_model": params.DiarizeModel,
	}

	// Handle pointer fields - only add if not nil
	if params.Language != nil {
		paramMap["language"] = *params.Language
	}
	if params.MinSpeakers != nil {
		paramMap["min_speakers"] = *params.MinSpeakers
	}
	if params.MaxSpeakers != nil {
		paramMap["max_speakers"] = *params.MaxSpeakers
	}
	if params.HfToken != nil {
		paramMap["hf_token"] = *params.HfToken
	}
	if params.ModelDir != nil {
		paramMap["model_dir"] = *params.ModelDir
	}
	if params.AlignModel != nil {
		paramMap["align_model"] = *params.AlignModel
	}
	if params.SuppressTokens != nil {
		paramMap["suppress_tokens"] = *params.SuppressTokens
	}
	if params.InitialPrompt != nil {
		paramMap["initial_prompt"] = *params.InitialPrompt
	}

	// Add remaining non-pointer fields
	paramMap["temperature"] = params.Temperature
	paramMap["best_of"] = params.BestOf
	paramMap["beam_size"] = params.BeamSize
	paramMap["patience"] = params.Patience
	paramMap["vad_method"] = params.VadMethod
	paramMap["vad_onset"] = params.VadOnset
	paramMap["vad_offset"] = params.VadOffset
	paramMap["context_left"] = params.AttentionContextLeft
	paramMap["context_right"] = params.AttentionContextRight
	paramMap["timestamps"] = true
	paramMap["output_format"] = OutputFormatJSON
	paramMap["auto_convert_audio"] = true

	// For Canary model, set source and target languages
	if params.ModelFamily == FamilyNvidiaCanary {
		if params.Language != nil {
			paramMap["source_lang"] = *params.Language
		} else {
			paramMap["source_lang"] = "en"
		}

		if params.Task == "translate" {
			paramMap["target_lang"] = "en" // Default target for translation
		} else {
			paramMap["target_lang"] = paramMap["source_lang"]
		}
	}

	return paramMap
}

// mergeDiarizationWithTranscription combines diarization results with transcription
func (u *UnifiedTranscriptionService) mergeDiarizationWithTranscription(transcript *interfaces.TranscriptResult, diarization *interfaces.DiarizationResult) *interfaces.TranscriptResult {
	logger.Info("Merging diarization with transcription",
		"transcript_segments", len(transcript.Segments),
		"diarization_segments", len(diarization.Segments))

	// Create a copy of the transcript to avoid modifying the original
	mergedTranscript := *transcript
	mergedTranscript.Segments = make([]interfaces.TranscriptSegment, len(transcript.Segments))
	copy(mergedTranscript.Segments, transcript.Segments)

	// Assign speakers to transcript segments based on timing overlap
	for i := range mergedTranscript.Segments {
		segment := &mergedTranscript.Segments[i]
		bestSpeaker := u.findBestSpeakerForSegment(segment.Start, segment.End, diarization.Segments)
		if bestSpeaker != "" {
			segment.Speaker = &bestSpeaker
		}
	}

	// Also assign speakers to words if available
	if len(transcript.WordSegments) > 0 {
		mergedTranscript.WordSegments = make([]interfaces.TranscriptWord, len(transcript.WordSegments))
		copy(mergedTranscript.WordSegments, transcript.WordSegments)

		for i := range mergedTranscript.WordSegments {
			word := &mergedTranscript.WordSegments[i]
			bestSpeaker := u.findBestSpeakerForSegment(word.Start, word.End, diarization.Segments)
			if bestSpeaker != "" {
				word.Speaker = &bestSpeaker
			}
		}
	}

	return &mergedTranscript
}

// findBestSpeakerForSegment finds the speaker with maximum overlap for a given time segment
func (u *UnifiedTranscriptionService) findBestSpeakerForSegment(start, end float64, diarizationSegments []interfaces.DiarizationSegment) string {
	maxOverlap := 0.0
	bestSpeaker := ""

	for _, diarSeg := range diarizationSegments {
		// Calculate overlap
		overlapStart := max(start, diarSeg.Start)
		overlapEnd := min(end, diarSeg.End)
		overlap := max(0, overlapEnd-overlapStart)

		if overlap > maxOverlap {
			maxOverlap = overlap
			bestSpeaker = diarSeg.Speaker
		}
	}

	return bestSpeaker
}

// saveTranscriptionResults saves the transcription results to the database
func (u *UnifiedTranscriptionService) saveTranscriptionResults(jobID string, result *interfaces.TranscriptResult) error {
	// Convert result to JSON string for database storage
	resultJSON, err := u.convertTranscriptResultToJSON(result)
	if err != nil {
		return fmt.Errorf("failed to convert result to JSON: %w", err)
	}

	// Update the job in the database
	if err := u.jobRepo.UpdateTranscript(context.Background(), jobID, resultJSON); err != nil {
		return fmt.Errorf("failed to update job transcript: %w", err)
	}

	logger.Info("Saved transcription results", "job_id", jobID, "text_length", len(result.Text))
	return nil
}

// convertTranscriptResultToJSON converts the interface result to JSON format
func (u *UnifiedTranscriptionService) convertTranscriptResultToJSON(result *interfaces.TranscriptResult) (string, error) {
	// Now that the struct fields match the JSON field names, we can directly marshal
	jsonBytes, err := json.Marshal(result)
	if err != nil {
		return "", err
	}

	return string(jsonBytes), nil
}

// GetSupportedModels returns all supported models through the new architecture
func (u *UnifiedTranscriptionService) GetSupportedModels() map[string]interfaces.ModelCapabilities {
	return u.registry.GetAllCapabilities()
}

// GetModelStatus returns the status of all models
func (u *UnifiedTranscriptionService) GetModelStatus(ctx context.Context) map[string]bool {
	return u.registry.GetModelStatus(ctx)
}

// ValidateModelParameters validates parameters for a specific model
func (u *UnifiedTranscriptionService) ValidateModelParameters(modelID string, params map[string]interface{}) error {
	return u.registry.ValidateModelParameters(modelID, params)
}

// Helper functions
func max(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

func min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
