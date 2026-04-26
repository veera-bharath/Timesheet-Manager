// AI provider abstraction — renderer side.
// All HTTP calls happen in main process via IPC. API keys never reach this module.

const MAX_MEMORY_ENTRIES = 40;       // ~2000-token rolling cap (avg ~50 chars/entry)
const MAX_ENTRY_CHARS    = 200;

let _settings = null;  // cached after first refreshSettings() call

export async function refreshSettings() {
    try {
        _settings = await window.ai.getSettings();
    } catch (e) {
        _settings = null;
    }
    return _settings;
}

export function isEnabled() {
    return !!(window.ai && _settings?.enabled);
}

export function isFeatureEnabled(featureKey) {
    if (!isEnabled()) return false;
    return _settings?.features?.[featureKey] !== false;
}

export function getProvider() {
    if (!_settings) return null;
    return _settings.provider === 'local' ? 'local' : (_settings.cloudProvider || 'claude');
}

export async function ask(prompt, context) {
    if (!isEnabled()) return null;
    try {
        return await window.ai.ask(prompt, context ?? null);
    } catch (e) {
        return null;
    }
}

export async function getMemory() {
    try {
        return await window.ai.getMemory();
    } catch (e) {
        return [];
    }
}

export async function updateMemory(entry) {
    try {
        const trimmed = String(entry).slice(0, MAX_ENTRY_CHARS);
        const current = await window.ai.getMemory();

        // Trim oldest entries to stay within cap before pushing the new one
        while (current.length >= MAX_MEMORY_ENTRIES) current.shift();

        // Also enforce approximate token cap (chars / 4 ≈ tokens)
        let totalChars = current.reduce((sum, e) => sum + String(e).length, 0) + trimmed.length;
        while (totalChars > 8000 && current.length > 0) {
            totalChars -= String(current.shift()).length;
        }

        await window.ai.updateMemory(trimmed);
    } catch (e) { /* silent */ }
}

export async function clearMemory() {
    try {
        await window.ai.clearMemory();
    } catch (e) { /* silent */ }
}
