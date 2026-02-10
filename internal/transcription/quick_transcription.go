package transcription

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"scriberr/internal/config"
	"scriberr/internal/models"
	"scriberr/internal/repository"
	"scriberr/internal/transcription/interfaces"
	"scriberr/pkg/logger"

	"github.com/google/uuid"
)

// QuickTranscriptionJob represents a temporary transcription job
type QuickTranscriptionJob struct {
	ID           string                `json:"id"`
	Title        string                `json:"title"`
	Status       models.JobStatus      `json:"status"`
	AudioPath    string                `json:"audio_path"`
	Transcript   *string               `json:"transcript,omitempty"`
	Parameters   models.WhisperXParams `json:"parameters"`
	CreatedAt    time.Time             `json:"created_at"`
	ExpiresAt    time.Time             `json:"expires_at"`
	ErrorMessage *string               `json:"error_message,omitempty"`
}

// QuickTranscriptionService handles temporary transcriptions without database persistence
type QuickTranscriptionService struct {
	config           *config.Config
	unifiedProcessor *UnifiedJobProcessor
	jobRepo          repository.JobRepository
	jobs             map[string]*QuickTranscriptionJob
	jobsMutex        sync.RWMutex
	tempDir          string
	cleanupTicker    *time.Ticker
	stopCleanup      chan bool
}

// NewQuickTranscriptionService creates a new quick transcription service
func NewQuickTranscriptionService(cfg *config.Config, unifiedProcessor *UnifiedJobProcessor, jobRepo repository.JobRepository) (*QuickTranscriptionService, error) {
	// Create temporary directory for quick transcriptions
	tempDir := filepath.Join(cfg.UploadDir, "quick_transcriptions")
	if err := os.MkdirAll(tempDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create temp directory: %v", err)
	}

	service := &QuickTranscriptionService{
		config:           cfg,
		unifiedProcessor: unifiedProcessor,
		jobRepo:          jobRepo,
		jobs:             make(map[string]*QuickTranscriptionJob),
		tempDir:          tempDir,
		stopCleanup:      make(chan bool),
	}

	// Start cleanup routine (run every hour)
	service.startCleanupRoutine()

	return service, nil
}

// SubmitQuickJob creates and processes a temporary transcription job
func (qs *QuickTranscriptionService) SubmitQuickJob(audioData io.Reader, filename string, params models.WhisperXParams, title string, sessionID string, saveToPortal bool, synchronous bool) (*QuickTranscriptionJob, error) {
	// Generate unique job ID
	jobID := uuid.New().String()

	// Determine target directory
	targetDir := qs.tempDir
	if saveToPortal {
		// Store in permanent uploads directory for live sessions
		targetDir = filepath.Join(qs.config.UploadDir, "live_sessions")
		if sessionID != "" {
			targetDir = filepath.Join(targetDir, sessionID)
		}
		if err := os.MkdirAll(targetDir, 0755); err != nil {
			return nil, fmt.Errorf("failed to create permanent directory: %v", err)
		}
	}

	// Create file for audio
	ext := filepath.Ext(filename)
	audioFilename := fmt.Sprintf("%s%s", jobID, ext)
	audioPath := filepath.Join(targetDir, audioFilename)

	// Save audio file
	audioFile, err := os.Create(audioPath)
	if err != nil {
		return nil, fmt.Errorf("failed to create audio file: %v", err)
	}
	defer audioFile.Close()

	if _, err := io.Copy(audioFile, audioData); err != nil {
		os.Remove(audioPath)
		return nil, fmt.Errorf("failed to save audio file: %v", err)
	}

	// If sessionID is provided, use it (or a variant) to regroup
	isLiveSession := sessionID != ""
	actualJobID := jobID
	if isLiveSession {
		actualJobID = sessionID
	}

	// Create quick transcription job record for this chunk
	now := time.Now()
	jobName := title
	if jobName == "" {
		jobName = "Quick Transcription"
	}

	// Set expiration: permanent jobs don't expire for 100 years
	expiresAt := now.Add(6 * time.Hour)
	if saveToPortal {
		expiresAt = now.Add(100 * 365 * 24 * time.Hour)
	}

	job := &QuickTranscriptionJob{
		ID:         actualJobID, // For internal tracking, we use actualJobID
		Title:      jobName,
		Status:     models.StatusPending,
		AudioPath:  audioPath,
		Parameters: params,
		CreatedAt:  now,
		ExpiresAt:  expiresAt,
	}

	// Store in memory (keyed by chunk ID for processing, but referencing session)
	qs.jobsMutex.Lock()
	qs.jobs[jobID] = job // Always key by the unique chunk ID
	qs.jobsMutex.Unlock()

	// Start processing
	if synchronous {
		qs.processQuickJob(jobID, actualJobID, isLiveSession, true)
	} else {
		go qs.processQuickJob(jobID, actualJobID, isLiveSession, false)
	}

	return job, nil
}

// GetQuickJob retrieves a quick transcription job by ID
func (qs *QuickTranscriptionService) GetQuickJob(jobID string) (*QuickTranscriptionJob, error) {
	qs.jobsMutex.RLock()
	defer qs.jobsMutex.RUnlock()

	job, exists := qs.jobs[jobID]
	if !exists {
		return nil, fmt.Errorf("job not found")
	}

	// Check if expired
	if time.Now().After(job.ExpiresAt) {
		return nil, fmt.Errorf("job expired")
	}

	return job, nil
}

// processQuickJob processes a quick transcription job
func (qs *QuickTranscriptionService) processQuickJob(chunkID string, sessionID string, isLive bool, synchronous bool) {
	// Update job status to processing
	qs.jobsMutex.Lock()
	job, exists := qs.jobs[chunkID]
	if !exists {
		qs.jobsMutex.Unlock()
		return
	}
	job.Status = models.StatusProcessing
	qs.jobsMutex.Unlock()

	// Ensure Python environment and embedded assets are ready
	if err := qs.unifiedProcessor.ensurePythonEnv(); err != nil {
		qs.jobsMutex.Lock()
		if job, exists := qs.jobs[chunkID]; exists {
			job.Status = models.StatusFailed
			msg := fmt.Sprintf("env setup failed: %v", err)
			job.ErrorMessage = &msg
		}
		qs.jobsMutex.Unlock()
		return
	}

	// For Live Session, check if master job exists
	ctx := context.Background()
	var masterJob *models.TranscriptionJob
	if isLive {
		masterJob, _ = qs.jobRepo.FindByID(ctx, sessionID)
	}

	if masterJob == nil {
		// Title is *string in models.TranscriptionJob
		titlePtr := &job.Title
		if job.Title == "" {
			defaultTitle := "Quick Transcription"
			titlePtr = &defaultTitle
		}

		// Create new master job or standalone job
		masterJob = &models.TranscriptionJob{
			ID:         sessionID,
			Title:      titlePtr,
			AudioPath:  job.AudioPath,
			Parameters: job.Parameters,
			Status:     models.StatusProcessing,
		}
		_ = qs.jobRepo.Create(ctx, masterJob)
	}

	logger.Info("Starting quick job processing", "chunk_id", chunkID, "session_id", sessionID)
	fmt.Printf(">>> BACKEND: Starting process for chunk %s (Session: %s)\n", chunkID, sessionID)

	// Create a temporary ID for this specific chunk processing to avoid DB conflicts
	tempProcessID := chunkID

	// Create temporary transcription job for WhisperX processing
	chunkTitle := "Processing Chunk"
	tempProcessJob := models.TranscriptionJob{
		ID:         tempProcessID,
		Title:      &chunkTitle,
		AudioPath:  job.AudioPath,
		Parameters: job.Parameters,
		Status:     models.StatusProcessing,
		Hidden:     true, // Hide from dashboard
	}

	// Save temporary job to database for processing
	if err := qs.jobRepo.Create(ctx, &tempProcessJob); err != nil {
		// Error handling...
		return
	}

	// Define the actual processing logic
	runProcessing := func() {
		// Use background context to prevent cancellation when request ends
		bgCtx := context.Background()
		err := qs.unifiedProcessor.ProcessJob(bgCtx, tempProcessID)

		// Load result and merge into master
		// IMPORTANT: Update 'job' transcript pointer here so SubmitQuickJob can return it!
		if processedJob, loadErr := qs.jobRepo.FindByID(bgCtx, tempProcessID); loadErr == nil && err == nil {
			if processedJob.Transcript != nil && *processedJob.Transcript != "" {
				fmt.Printf(">>> SUCCESS: Chunk %s yielded transcript. Merging...\n", chunkID)
				
				// Extract speaker-aware text
				var result interfaces.TranscriptResult
				if jsonErr := json.Unmarshal([]byte(*processedJob.Transcript), &result); jsonErr == nil {
					// Format text with speakers if segments exist
					formattedText := ""
					if len(result.Segments) > 0 {
						currentSpeaker := ""
						for _, seg := range result.Segments {
							speaker := "Unknown"
							if seg.Speaker != nil {
								speaker = *seg.Speaker
							}
							
							// If speaker changed or format needed
							if speaker != currentSpeaker {
								if formattedText != "" {
									formattedText += "\n"
								}
								formattedText += fmt.Sprintf("[%s]: ", speaker)
								currentSpeaker = speaker
							}
							formattedText += seg.Text + " "
						}
					} else {
						formattedText = result.Text
					}

					// Update the in-memory job so synchronous callers see the text
					qs.jobsMutex.Lock()
					if qj, exists := qs.jobs[chunkID]; exists {
						qj.Transcript = &formattedText 
					}
					qs.jobsMutex.Unlock()
				}

				// Do the DB merge
				qs.mergeChunkIntoMaster(bgCtx, sessionID, *processedJob.Transcript)
			} else {
				fmt.Printf(">>> WARNING: Chunk %s transcript is EMPTY\n", chunkID)
			}
		} else if err != nil {
			fmt.Printf(">>> ERROR: Chunk %s failed: %v\n", chunkID, err)
		}

		// Update in-memory status
		qs.jobsMutex.Lock()
		if qj, exists := qs.jobs[chunkID]; exists {
			qj.Status = models.StatusCompleted
			if err != nil {
				qj.Status = models.StatusFailed
			}
		}
		qs.jobsMutex.Unlock()

		// Clean up temporary processing job
		_ = qs.jobRepo.Delete(bgCtx, tempProcessID)
	}

	// Execute processing
	if synchronous {
		runProcessing()
	} else {
		go runProcessing()
	}
}

func (qs *QuickTranscriptionService) mergeChunkIntoMaster(ctx context.Context, masterID string, newTranscriptJSON string) {
	master, err := qs.jobRepo.FindByID(ctx, masterID)
	if err != nil {
		return
	}

	var newResult interfaces.TranscriptResult
	if err := json.Unmarshal([]byte(newTranscriptJSON), &newResult); err != nil {
		return
	}

	var currentDuration float64 = 0
	if master.Transcript != nil && *master.Transcript != "" && *master.Transcript != "{}" {
		var masterResult interfaces.TranscriptResult
		if err := json.Unmarshal([]byte(*master.Transcript), &masterResult); err == nil {
			// Calculate offset based on existing segments
			for _, seg := range masterResult.Segments {
				if seg.End > currentDuration {
					currentDuration = seg.End
				}
			}
			
			// Append new text
			if masterResult.Text != "" && !strings.HasSuffix(masterResult.Text, " ") {
				masterResult.Text += " "
			}
			masterResult.Text += newResult.Text

			// Offset and append new segments
			for i := range newResult.Segments {
				newResult.Segments[i].Start += currentDuration
				newResult.Segments[i].End += currentDuration
				masterResult.Segments = append(masterResult.Segments, newResult.Segments[i])
			}

			updatedJSON, _ := json.Marshal(masterResult)
			_ = qs.jobRepo.UpdateTranscript(ctx, masterID, string(updatedJSON))
			return
		}
	}

	// If it's the first chunk or fallback
	_ = qs.jobRepo.UpdateTranscript(ctx, masterID, newTranscriptJSON)
}

// processWithWhisperX processes the job using WhisperX service

// loadTranscriptFromTemp loads transcript from temporary file
func (qs *QuickTranscriptionService) loadTranscriptFromTemp(jobID string) (string, error) {
	transcriptPath := filepath.Join(qs.tempDir, jobID+"_transcript.json")
	data, err := os.ReadFile(transcriptPath)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// startCleanupRoutine starts the background cleanup routine
func (qs *QuickTranscriptionService) startCleanupRoutine() {
	qs.cleanupTicker = time.NewTicker(1 * time.Hour)
	go func() {
		for {
			select {
			case <-qs.cleanupTicker.C:
				qs.cleanupExpiredJobs()
			case <-qs.stopCleanup:
				qs.cleanupTicker.Stop()
				return
			}
		}
	}()
}

// cleanupExpiredJobs removes expired jobs and their files
func (qs *QuickTranscriptionService) cleanupExpiredJobs() {
	qs.jobsMutex.Lock()
	defer qs.jobsMutex.Unlock()

	now := time.Now()
	for jobID, job := range qs.jobs {
		if now.After(job.ExpiresAt) {
			// Remove files
			os.Remove(job.AudioPath)
			os.Remove(filepath.Join(qs.tempDir, jobID+"_transcript.json"))
			os.RemoveAll(filepath.Join(qs.tempDir, jobID+"_output"))

			// Remove from memory
			delete(qs.jobs, jobID)

			fmt.Printf("DEBUG: Cleaned up expired quick transcription job: %s\n", jobID)
		}
	}
}

// FinalizeJob merges all audio chunks for a live session and updates the master job
func (qs *QuickTranscriptionService) FinalizeJob(ctx context.Context, sessionID string) error {
	logger.Info("Finalizing live transcription job", "session_id", sessionID)

	// Check if this is a live session with permanent storage
	liveDir := filepath.Join(qs.config.UploadDir, "live_sessions", sessionID)
	if _, err := os.Stat(liveDir); os.IsNotExist(err) {
		return nil // Not a permanent live session, nothing to merge
	}

	// List all files in the directory
	files, err := os.ReadDir(liveDir)
	if err != nil {
		return fmt.Errorf("failed to read live session directory: %v", err)
	}

	var audioFiles []string
	for _, f := range files {
		if !f.IsDir() && (strings.HasSuffix(f.Name(), ".webm") || strings.HasSuffix(f.Name(), ".ogg") || strings.HasSuffix(f.Name(), ".mp3")) {
			audioFiles = append(audioFiles, filepath.Join(liveDir, f.Name()))
		}
	}

	if len(audioFiles) <= 1 {
		return nil // Only one chunk or none, no need to merge
	}

	// Sort files by creation time to ensure correct order
	sort.Slice(audioFiles, func(i, j int) bool {
		infoI, _ := os.Stat(audioFiles[i])
		infoJ, _ := os.Stat(audioFiles[j])
		return infoI.ModTime().Before(infoJ.ModTime())
	})

	// Create a text file for ffmpeg concat
	listPath := filepath.Join(liveDir, "files.txt")
	listContent := ""
	for _, f := range audioFiles {
		// Escape single quotes for ffmpeg
		escaped := strings.ReplaceAll(filepath.Base(f), "'", "'\\''")
		listContent += fmt.Sprintf("file '%s'\n", escaped)
	}

	if err := os.WriteFile(listPath, []byte(listContent), 0644); err != nil {
		return fmt.Errorf("failed to create ffmpeg list file: %v", err)
	}

	// Merge audio using ffmpeg (re-encode to MP3 because input is likely WebM/Opus)
	outputPath := filepath.Join(liveDir, "merged_audio.mp3")
	cmd := exec.Command("ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", listPath, "-acodec", "libmp3lame", "-q:a", "2", outputPath)
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("ffmpeg concat failed: %v, output: %s", err, string(output))
	}

	// Update the master job's audio path in the database
	if err := qs.jobRepo.UpdateAudioPath(ctx, sessionID, outputPath); err != nil {
		logger.Error("Failed to update master job audio path", "session_id", sessionID, "error", err)
	}

	// Cleanup the list file
	os.Remove(listPath)

	logger.Info("Successfully finalized and merged audio for live job", "session_id", sessionID, "output", outputPath)
	return nil
}

// Close stops the cleanup routine
func (qs *QuickTranscriptionService) Close() {
	if qs.cleanupTicker != nil {
		close(qs.stopCleanup)
	}
}
