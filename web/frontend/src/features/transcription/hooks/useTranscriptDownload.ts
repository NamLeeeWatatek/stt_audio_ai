import type { Transcript } from "@/features/transcription/hooks/useAudioDetail";

export function useTranscriptDownload() {

    const formatSRTTime = (seconds: number): string => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        const milliseconds = Math.floor((seconds % 1) * 1000);

        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')},${milliseconds.toString().padStart(3, '0')}`;
    };

    const formatTimestamp = (seconds: number): string => {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
    };

    const downloadFile = (content: string, filename: string, contentType: string) => {
        const blob = new Blob([content], { type: contentType });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const getDisplaySpeakerName = (originalSpeaker: string, mappings: Record<string, string>) => {
        return mappings[originalSpeaker] || originalSpeaker;
    };

    const downloadSRT = (transcript: Transcript, filenameBase: string, speakerMappings: Record<string, string>) => {
        if (!transcript) return;

        let srtContent = '';
        let counter = 1;

        if (transcript.segments) {
            transcript.segments.forEach((segment) => {
                const startTime = formatSRTTime(segment.start);
                const endTime = formatSRTTime(segment.end);
                let text = segment.text.trim();

                if (segment.speaker) {
                    text = `${getDisplaySpeakerName(segment.speaker, speakerMappings)}: ${text}`;
                }

                srtContent += `${counter}\n${startTime} --> ${endTime}\n${text}\n\n`;
                counter++;
            });
        } else {
            srtContent = `1\n00:00:00,000 --> 99:59:59,999\n${transcript.text}\n\n`;
        }

        downloadFile(srtContent, `${filenameBase}.srt`, 'text/plain');
    };

    const downloadTXT = (
        transcript: Transcript,
        filenameBase: string,
        speakerMappings: Record<string, string>,
        options: { includeTimestamps: boolean; includeSpeakerLabels: boolean }
    ) => {
        if (!transcript) return;

        let content = '';

        if (!options.includeSpeakerLabels && !options.includeTimestamps) {
            content = transcript.text;
        } else if (transcript.segments) {
            let currentBlockSpeaker: string | undefined = undefined;
            let currentBlockText: string = "";
            let currentBlockStart: number = 0;

            transcript.segments.forEach((segment, index) => {
                // Determine effective speaker for this segment
                // If segment has speaker, use it. If not, inherit from previous (fill-in).
                let effectiveSpeaker = segment.speaker;
                if (!effectiveSpeaker && currentBlockSpeaker) {
                    effectiveSpeaker = currentBlockSpeaker;
                }

                // If it's the very first segment and still no speaker, default to "Unknown"
                if (!effectiveSpeaker && index === 0 && options.includeSpeakerLabels) {
                    effectiveSpeaker = "Unknown Speaker";
                }

                // Check if we should start a new block
                // New block if:
                // 1. Speaker changes (and we care about speakers)
                // 2. Or if we are just listing timestamps for every segment (if that was the simplified logic, 
                //    but "clean text" usually implies grouping. Let's assume grouping by speaker is desired).
                // Actually, if timestamps are requested, maybe user wants granular timestamps?
                // The user complaint was "txt có vẻ không chuẩn xác... bị lỗi... không chuẩn".
                // The image shows very fragmented text. Grouping by speaker is the standard "Meeting Minutes" format.

                const isNewBlock = (effectiveSpeaker !== currentBlockSpeaker);

                if (isNewBlock) {
                    // Flush previous block if exists
                    if (currentBlockText.length > 0) { // Typo fix: currentBlockText
                        // Determine label for previous block
                        let blockHeader = "";
                        if (options.includeTimestamps) {
                            blockHeader += `[${formatTimestamp(currentBlockStart)}] `;
                        }
                        if (options.includeSpeakerLabels && currentBlockSpeaker) {
                            blockHeader += `${getDisplaySpeakerName(currentBlockSpeaker, speakerMappings)}: `;
                        }

                        if (content.length > 0) content += "\n\n";
                        content += `${blockHeader}${currentBlockText.trim()}`;
                    }

                    // Start new block
                    currentBlockSpeaker = effectiveSpeaker;
                    currentBlockStart = segment.start;
                    currentBlockText = segment.text;
                } else {
                    // Append to current block
                    currentBlockText += " " + segment.text;
                }
            });

            // Flush final block
            if (currentBlockText.length > 0) {
                let blockHeader = "";
                if (options.includeTimestamps) {
                    blockHeader += `[${formatTimestamp(currentBlockStart)}] `;
                }
                if (options.includeSpeakerLabels && currentBlockSpeaker) {
                    blockHeader += `${getDisplaySpeakerName(currentBlockSpeaker, speakerMappings)}: `;
                }

                if (content.length > 0) content += "\n\n";
                content += `${blockHeader}${currentBlockText.trim()}`;
            }

        } else {
            content = transcript.text;
        }

        downloadFile(content, `${filenameBase}.txt`, 'text/plain');
    };

    const downloadJSON = (
        transcript: Transcript,
        filenameBase: string,
        speakerMappings: Record<string, string>,
        options: { includeTimestamps: boolean; includeSpeakerLabels: boolean }
    ) => {
        if (!transcript) return;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let jsonData: any;

        if (!options.includeSpeakerLabels && !options.includeTimestamps) {
            jsonData = {
                text: transcript.text,
                format: 'simple'
            };
        } else if (transcript.segments) {
            jsonData = {
                text: transcript.text,
                format: 'segmented',
                segments: transcript.segments.map(segment => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const segmentData: any = {
                        text: segment.text.trim()
                    };

                    if (options.includeTimestamps) {
                        segmentData.start = segment.start;
                        segmentData.end = segment.end;
                        segmentData.timestamp = formatTimestamp(segment.start);
                    }

                    if (options.includeSpeakerLabels && segment.speaker) {
                        segmentData.speaker = getDisplaySpeakerName(segment.speaker, speakerMappings);
                    }

                    return segmentData;
                })
            };
        } else {
            jsonData = {
                text: transcript.text,
                format: 'simple'
            };
        }

        downloadFile(JSON.stringify(jsonData, null, 2), `${filenameBase}.json`, 'application/json');
    };

    return { downloadSRT, downloadTXT, downloadJSON };
}
