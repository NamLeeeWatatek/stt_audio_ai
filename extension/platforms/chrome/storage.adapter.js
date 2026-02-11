export class ChromeStorageAdapter {
    async get(key) {
        const result = await chrome.storage.local.get([key]);
        return result[key];
    }

    async set(key, value) {
        await chrome.storage.local.set({ [key]: value });
    }

    async remove(key) {
        await chrome.storage.local.remove([key]);
    }
}
