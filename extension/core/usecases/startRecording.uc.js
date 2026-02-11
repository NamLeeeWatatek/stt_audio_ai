import { MESSAGE_TYPES, STORAGE_KEYS } from '../../shared/message.types.js';

export async function startRecordingUseCase({ browser, storage }, { streamId, targetTabId, meetingName, mode }) {
    // 1. Setup offscreen document if not exists
    const hasOffscreen = await browser.hasOffscreenDocument();
    if (!hasOffscreen) {
        await browser.createOffscreenDocument('offscreen/offscreen.html', ['USER_MEDIA', 'AUDIO_PLAYBACK'], 'Capture and process meeting audio');
        // Wait a bit for offscreen to initialize
        await new Promise(r => setTimeout(r, 800));
    }

    // 2. Send START_RECORDING to offscreen
    await browser.sendMessage({
        type: MESSAGE_TYPES.START_RECORDING,
        target: 'offscreen',
        streamId,
        targetTabId,
        meetingName,
        mode: mode || 'tab'
    });

    // 3. Notify the tab that recording started
    if (targetTabId) {
        await browser.sendMessageToTab(parseInt(targetTabId), { type: MESSAGE_TYPES.START_RECORDING });
    }

    // 4. Update storage state
    await storage.set(STORAGE_KEYS.IS_RECORDING, true);
    await storage.set(STORAGE_KEYS.RECORDING_TAB, targetTabId);

    return { success: true };
}
