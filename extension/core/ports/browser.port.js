export class BrowserPort {
    async getActiveTab() {
        throw new Error("Not implemented");
    }

    async getMediaStreamId(tabId) {
        throw new Error("Not implemented");
    }

    async sendMessage(message) {
        throw new Error("Not implemented");
    }

    async sendMessageToTab(tabId, message) {
        throw new Error("Not implemented");
    }

    async createOffscreenDocument(url, reasons, justification) {
        throw new Error("Not implemented");
    }

    async closeOffscreenDocument() {
        throw new Error("Not implemented");
    }

    async hasOffscreenDocument() {
        throw new Error("Not implemented");
    }
}
