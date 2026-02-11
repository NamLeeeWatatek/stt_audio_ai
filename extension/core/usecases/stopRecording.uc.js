import { MESSAGE_TYPES, STORAGE_KEYS } from '../../shared/message.types.js';

export async function stopRecordingUseCase({ browser, storage }) {
    // 1. Send STOP_RECORDING to offscreen
    // 1. Send STOP_RECORDING to offscreen and WAIT for completion
    try {
        await browser.sendMessage({
            type: MESSAGE_TYPES.STOP_RECORDING,
            target: 'offscreen'
        }, true);
    } catch (e) {
        console.warn("Offscreen stop message failed:", e);
    }

    // 2. Notify all tabs (or specific tab) to stop recording UI
    // For simplicity, we can notify current recording tab or all tabs
    const recordingTabId = await storage.get(STORAGE_KEYS.RECORDING_TAB);
    if (recordingTabId) {
        await browser.sendMessageToTab(parseInt(recordingTabId), { type: MESSAGE_TYPES.STOP_RECORDING });
    }

    // 3. Update storage state
    await storage.set(STORAGE_KEYS.IS_RECORDING, false);
    await storage.remove(STORAGE_KEYS.RECORDING_TAB);

    // 4. Close offscreen document after a delay
    setTimeout(async () => {
        const hasOffscreen = await browser.hasOffscreenDocument();
        if (hasOffscreen) {
            await browser.closeOffscreenDocument();
        }
    }, 1000);

    return { success: true };
}
