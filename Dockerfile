# Multi-stage build for Scriberr: builds React UI and Go server, then
# ships a slim runtime with minimal dependencies.

########################
# UI build stage
########################
FROM node:20-alpine AS ui-builder
WORKDIR /web

# Install deps and build web/frontend
COPY web/frontend/package*.json ./frontend/
RUN cd frontend \
  && npm ci

COPY web/frontend ./frontend
RUN cd frontend \
  && npm run build


########################
# Go build stage
########################
FROM golang:1.24-bookworm AS go-builder
WORKDIR /src

# Pre-cache modules
COPY go.mod go.sum ./
RUN go mod download

# Copy source code ONLY after installing dependencies to leverage cache
COPY . .

# HACK: Add websocket dependency inside container since host lacks Go
# This must run AFTER copying source code, as the host's go.mod (which lacks the dep)
# would overwrite our changes if we ran this before copying.
RUN go get github.com/gorilla/websocket

# Copy built UI into embed path
RUN rm -rf internal/web/dist && mkdir -p internal/web
COPY --from=ui-builder /web/frontend/dist internal/web/dist

# Build binary (arch matches builder platform)
RUN CGO_ENABLED=0 \
  go build -o /out/scriberr cmd/server/main.go

# Build CLI binaries (cross-platform)
RUN mkdir -p /out/bin/cli \
  && GOOS=linux GOARCH=amd64 go build -o /out/bin/cli/scriberr-linux-amd64 ./cmd/scriberr-cli \
  && GOOS=darwin GOARCH=amd64 go build -o /out/bin/cli/scriberr-darwin-amd64 ./cmd/scriberr-cli \
  && GOOS=darwin GOARCH=arm64 go build -o /out/bin/cli/scriberr-darwin-arm64 ./cmd/scriberr-cli \
  && GOOS=windows GOARCH=amd64 go build -o /out/bin/cli/scriberr-windows-amd64.exe ./cmd/scriberr-cli


########################
# Runtime stage
########################
FROM python:3.11-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
  HOST=0.0.0.0 \
  PORT=8080 \
  DATABASE_PATH=/app/data/scriberr.db \
  UPLOAD_DIR=/app/data/uploads \
  APP_ENV=production \
  PUID=1000 \
  PGID=1000 \
  LOW_MEMORY_MODE=true \
  ENABLED_MODELS=groq_whisper,fpt_ai,openai_whisper

WORKDIR /app

# System deps: 
# - curl: for downloading tools
# - ffmpeg: required for audio processing (cutting, format conversion)
# - git: used by some python tools if needed, though we try to keep it minimal
# - gosu: for user switching
# Note: We REMOVED build-essential, gcc, g++ because we are NO LONGER compiling massive AI libraries.
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  curl ca-certificates ffmpeg git gosu unzip \
  && rm -rf /var/lib/apt/lists/*

# Install yt-dlp standalone binary (Go-based or compiled python) - easiest is the official release
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && yt-dlp --version

# Install Deno (JavaScript runtime required for yt-dlp YouTube downloads)
RUN curl -fsSL https://deno.land/install.sh | sh \
  && cp /root/.deno/bin/deno /usr/local/bin/deno \
  && chmod 755 /usr/local/bin/deno \
  && deno --version

# Create default user and directories
RUN groupadd -g 1000 appuser \
  && useradd -m -u 1000 -g 1000 appuser \
  && mkdir -p /app/data/uploads /app/data/transcripts \
  && chown -R appuser:appuser /app

# NOTE: We removed the entire WhisperX/PyTorch block. 
# This assumes the user is switching to Cloud APIs (Groq, OpenAI, FPT).
# If local inference is needed again, those blocks must be restored.

# Copy binary and entrypoint script
COPY --from=go-builder /out/scriberr /app/scriberr
COPY --from=go-builder /out/bin/cli /app/bin/cli
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Make entrypoint script executable and set up basic permissions
# Fix CRLF line endings (Windows issues)
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
  && chmod +x /usr/local/bin/docker-entrypoint.sh \
  && chown appuser:appuser /app/scriberr

# Expose port and declare volume for persistence
EXPOSE 8080
VOLUME ["/app/data"]

# Use entrypoint script that handles user switching and permissions
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["/app/scriberr"]
