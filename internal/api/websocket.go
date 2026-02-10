package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"scriberr/internal/models"
	"scriberr/pkg/logger"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for extension
	},
}

// WebSocketMessage represents the protocol message
type WebSocketMessage struct {
	Type    string          `json:"type"` // "config", "audio", "ping"
	Payload json.RawMessage `json:"payload,omitempty"`
}

// StreamConfig represents the configuration sent by client
type StreamConfig struct {
	SessionID  string `json:"session_id"`
	MeetingName string `json:"meeting_name"`
	SampleRate int    `json:"sample_rate"`
}

// TranscriptionStreamHandler handles real-time audio streaming
func (h *Handler) TranscriptionStreamHandler(c *gin.Context) {
	ws, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		logger.Error("Failed to upgrade websocket", "error", err)
		return
	}
	defer ws.Close()

	sessionID := fmt.Sprintf("stream_%d", time.Now().UnixNano())
	var config StreamConfig
	var audioFile *os.File

	defer func() {
		if audioFile != nil {
			audioFile.Close()
		}
	}()
	
	// Message loop
	for {
		mt, message, err := ws.ReadMessage()
		if err != nil {
			logger.Warn("WebSocket read error", "error", err)
			break
		}

		if mt == websocket.TextMessage {
			// Handle control messages
			var msg WebSocketMessage
			if err := json.Unmarshal(message, &msg); err != nil {
				continue
			}

			if msg.Type == "config" {
				_ = json.Unmarshal(msg.Payload, &config)
				if config.SessionID != "" {
					sessionID = config.SessionID
				}
				logger.Info("Stream configured", "session_id", sessionID)

				// Create job in DB so Finalize won't fail
				// We assume AudioPath will be constructed based on sessionID
				uploadDir := h.config.UploadDir
				filename := fmt.Sprintf("%s.webm", sessionID)
				filePath := filepath.Join(uploadDir, filename)

				// Create audio file
				f, err := os.OpenFile(filePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
				if err != nil {
					logger.Error("Failed to create audio file", "error", err)
					return
				}
				audioFile = f

				// Create or update job record
				job := models.TranscriptionJob{
					ID:        sessionID,
					AudioPath: filePath,
					Status:    models.StatusProcessing, // Mark as processing since it's live
					CreatedAt: time.Now(),
				}
				if config.MeetingName != "" {
					title := config.MeetingName
					job.Title = &title
				} else {
					title := fmt.Sprintf("Live Session %s", sessionID)
					job.Title = &title
				}

				// Check if exists
				if existing, err := h.jobRepo.FindByID(c.Request.Context(), sessionID); err == nil && existing != nil {
					logger.Info("Job already exists", "job_id", sessionID)
				} else {
					if err := h.jobRepo.Create(c.Request.Context(), &job); err != nil {
						logger.Error("Failed to create job", "error", err)
					}
				}
			}
		} else if mt == websocket.BinaryMessage {
			// Handle audio data
			if audioFile != nil {
				if _, err := audioFile.Write(message); err != nil {
					logger.Error("Failed to write audio chunk", "error", err)
				}
			}
		}
	}
}
