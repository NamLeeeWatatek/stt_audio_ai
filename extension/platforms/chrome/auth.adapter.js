import { STORAGE_KEYS } from '../../shared/message.types.js';

export class ChromeAuthAdapter {
    async getAccessToken() {
        return new Promise((resolve) => {
            chrome.storage.local.get([STORAGE_KEYS.ACCESS_TOKEN], (result) => {
                resolve(result[STORAGE_KEYS.ACCESS_TOKEN] || null);
            });
        });
    }

    async setAccessToken(token) {
        return new Promise((resolve) => {
            chrome.storage.local.set({ [STORAGE_KEYS.ACCESS_TOKEN]: token }, () => {
                resolve();
            });
        });
    }

    async clearAuth() {
        return new Promise((resolve) => {
            chrome.storage.local.remove([STORAGE_KEYS.ACCESS_TOKEN, STORAGE_KEYS.USER_INFO], () => {
                resolve();
            });
        });
    }

    async isAuthenticated() {
        const token = await this.getAccessToken();
        return !!token;
    }

    async getUserInfo() {
        return new Promise((resolve) => {
            chrome.storage.local.get([STORAGE_KEYS.USER_INFO], (result) => {
                resolve(result[STORAGE_KEYS.USER_INFO] || null);
            });
        });
    }

    async setUserInfo(info) {
        return new Promise((resolve) => {
            chrome.storage.local.set({ [STORAGE_KEYS.USER_INFO]: info }, () => {
                resolve();
            });
        });
    }
}
