// ==UserScript==
// @name         cbtranslate
// @namespace    bloomfi3ld
// @version      1.0.2.1.7
// @description  Minimal private-message translator for adult supported sites.
// @author       bloomfi3ld
// @match        https://*.chaturbate.com/*
// @match        https://*.stripchat.com/*
// @updateURL    https://raw.githubusercontent.com/bloomfi3ld/cbtranslate/master/cbtranslate.user.js
// @downloadURL  https://raw.githubusercontent.com/bloomfi3ld/cbtranslate/master/cbtranslate.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @connect      translate.googleapis.com
// @connect      clients5.google.com
// Disabled: @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const CONFIG = {
        targetLanguage: 'es',
        outgoingTargetLanguage: 'en',
        sourceLanguage: 'auto',
        initialBatchMessageLimit: 8,
        initialBatchCharLimit: 1800,
        newMessageBatchMessageLimit: 4,
        newMessageBatchCharLimit: 800,
        newMessageDebounceMs: 350,
        rootPollMs: 1000,
        observerSettleMs: 120,
        apiRetryAttempts: 3,
        apiRetryDelayMs: 450,
        outgoingLockMaxMs: 4000,
        translateOutgoingComposer: true,
        translateOwnMessages: true,
        skipMessagesAlreadyInTargetLanguage: true,
        debug: true,
        /**
         * Configuración de telemetría.
         * Su propósito es recopilar logs, errores y snapshots del DOM en tiempo real
         * para poder depurar el script en producción cuando falla o cambian los selectores.
         */
        telemetry: {
            enabled: false,
            endpoint: 'http://127.0.0.1:7777/ingest',
            endpointStorageKey: 'qtranslate-script:telemetry:endpoint',
            maxQueueSize: 1500,
            batchSize: 25,
            flushIntervalMs: 2500,
            requestTimeoutMs: 15000,
            maxStringLength: 4000,
            maxPayloadDepth: 6,
            maxArrayItems: 25,
            mirrorConsole: true,
            domSnapshotMaxHtmlLength: 6000,
            domSnapshotMaxTextLength: 500,
            domSnapshotCooldownMs: 15000,
            recordingDurationMs: 180000,
            recordingSnapshotIntervalMs: 2500,
            recordingMutationThrottleMs: 1500,
        },
    };

    const STORAGE_KEY = 'qtranslate-script:v1';
    const MARKER_PREFIX = '[[QTS_MSG_';
    const MARKER_SUFFIX = ']]';
    const END_MARKER = '[[QTS_END]]';
    const STYLE_ID = 'qtranslate-script-style';
    const TRANSLATION_BLOCK_CLASS = 'qts-translation-block';
    const OUTGOING_MESSAGE_DB_NAME = 'qtranslate-script-db';
    const OUTGOING_MESSAGE_DB_VERSION = 3;
    const OUTGOING_MESSAGE_STORE_NAME = 'outgoing_messages';
    const INCOMING_SETTINGS_STORE_NAME = 'incoming_settings';
    const DETECTED_LANGUAGE_STORE_NAME = 'detected_languages';
    const OUTGOING_MESSAGE_META_STORE_NAME = 'outgoing_message_meta';
    const TRANSLATION_CACHE_STORE_NAME = 'translation_cache';
    const OUTGOING_MESSAGE_TTL_MS = 48 * 60 * 60 * 1000;
    const TRANSLATION_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    const OUTGOING_KEY_ROTATION_MS = 48 * 60 * 60 * 1000;
    const OUTGOING_KEY_DECRYPT_RETENTION_MS = OUTGOING_KEY_ROTATION_MS + OUTGOING_MESSAGE_TTL_MS;
    const GM_SECURE_KEYRING_STORAGE_KEY = 'qts-secure-outgoing:keyring:v1';
    const GM_SECURE_OUTGOING_RECORD_PREFIX = 'qts-secure-outgoing:record:';
    const GM_SECURE_OUTGOING_META_PREFIX = 'qts-secure-outgoing:meta:';
    const TELEMETRY_INSTALL_ID_STORAGE_KEY = 'qtranslate-script:telemetry:installId';
    const TELEMETRY_RECORDING_STORAGE_KEY = 'qtranslate-script:telemetry:recording';
    const TELEMETRY_SESSION_ID = `qts-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const TELEMETRY_INSTALL_ID = getOrCreateTelemetryInstallId();
    const DOM_SNAPSHOT_CAPTURE_STATE = new Map();
    const TRANSLATION_TOGGLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" fill="none" viewBox="0 0 14 13" role="img"><path fill="#00779F" d="M.869 8.64a.212.212 0 0 1 .367 0l.84 1.463c.075.143-.023.322-.188.322h-.352v.27c0 .593.48 1.08 1.08 1.08h1.327c.173 0 .308.135.308.308v.465a.304.304 0 0 1-.308.307H2.631a2.16 2.16 0 0 1-2.16-2.16v-.27H.216a.216.216 0 0 1-.187-.322z"></path><path fill="#00779F" fill-rule="evenodd" d="M8.54 6.78c.18-.36.766-.36.946 0l.008-.007 2.655 5.302a.534.534 0 0 1-.24.713.5.5 0 0 1-.24.06.52.52 0 0 1-.473-.293l-.915-1.83H7.754l-.915 1.83a.53.53 0 0 1-.713.24.536.536 0 0 1-.24-.712zM8.28 9.675h1.47l-.736-1.462z" clip-rule="evenodd"></path><path fill="#00779F" d="M7.01 1.583c.293 0 .533.24.533.532s-.24.533-.532.533h-.78l-.9 1.357-.068.083-.952.953 1.477 1.477V6.51c.21.21.21.54 0 .75a.53.53 0 0 1-.75 0L3.561 5.782 2.084 7.261a.53.53 0 1 1-.75-.75L2.81 5.032l-.953-.952a.526.526 0 0 1 0-.75c.21-.21.54-.21.75 0l.953.952.915-.914.48-.72H.644a.535.535 0 0 1-.533-.533c0-.292.24-.532.533-.532zM10.866 1.59a2.16 2.16 0 0 1 2.16 2.16v.27h.24c.165 0 .27.18.187.323l-.84 1.462a.212.212 0 0 1-.367 0l-.84-1.462c-.075-.143.023-.323.188-.323h.352v-.27c0-.592-.48-1.08-1.08-1.08H9.554a.304.304 0 0 1-.308-.307v-.465c0-.173.135-.308.308-.308zM3.831 0c.293 0 .533.24.533.532s-.24.533-.533.533H3.3a.535.535 0 0 1-.533-.533C2.766.24 3.006 0 3.3 0z"></path></svg>`;
    const BACKLOG_PROGRESS_MIN_VISIBLE_MS = 900;
    const BING_LANGUAGE_OPTIONS = Object.freeze([
        { code: 'auto', label: 'Auto-detect' },
        { code: 'es', label: 'Spanish (Español)' },
        { code: 'en', label: 'English' },
        { code: 'af', label: 'Afrikaans' },
        { code: 'sq', label: 'Albanian (Shqip)' },
        { code: 'am', label: 'Amharic (አማርኛ)' },
        { code: 'ar', label: 'Arabic (العربية)' },
        { code: 'hy', label: 'Armenian (Հայերեն)' },
        { code: 'as', label: 'Assamese (অসমীয়া)' },
        { code: 'az', label: 'Azerbaijani (Azərbaycan)' },
        { code: 'bn', label: 'Bangla (বাংলা)' },
        { code: 'ba', label: 'Bashkir' },
        { code: 'eu', label: 'Basque (Euskara)' },
        { code: 'be', label: 'Belarusian (беларуская)' },
        { code: 'bho', label: 'Bhojpuri (भोजपुरी)' },
        { code: 'brx', label: 'Bodo (बड़ो)' },
        { code: 'bs', label: 'Bosnian (Bosanski)' },
        { code: 'bg', label: 'Bulgarian (Български)' },
        { code: 'yue', label: 'Cantonese (Traditional) (粵語 (繁體))' },
        { code: 'ca', label: 'Catalan (Català)' },
        { code: 'hne', label: 'Chhattisgarhi (छत्तीसगढ़ी)' },
        { code: 'lzh', label: 'Chinese (Literary) (中文 (文言文))' },
        { code: 'zh-Hans', label: 'Chinese Simplified (中文 (简体))' },
        { code: 'zh-Hant', label: 'Chinese Traditional (繁體中文 (繁體))' },
        { code: 'hr', label: 'Croatian (Hrvatski)' },
        { code: 'cs', label: 'Czech (Čeština)' },
        { code: 'da', label: 'Danish (Dansk)' },
        { code: 'prs', label: 'Dari (دری)' },
        { code: 'dv', label: 'Divehi (ދިވެހިބަސް)' },
        { code: 'doi', label: 'Dogri (डोगरी)' },
        { code: 'nl', label: 'Dutch (Nederlands)' },
        { code: 'et', label: 'Estonian (Eesti)' },
        { code: 'fo', label: 'Faroese (Føroyskt)' },
        { code: 'fj', label: 'Fijian (Na Vosa Vakaviti)' },
        { code: 'fil', label: 'Filipino' },
        { code: 'fi', label: 'Finnish (Suomi)' },
        { code: 'fr-CA', label: 'French (Canada) (Français (Canada))' },
        { code: 'fr', label: 'French (Français)' },
        { code: 'gl', label: 'Galician (Galego)' },
        { code: 'lug', label: 'Ganda' },
        { code: 'ka', label: 'Georgian (ქართული)' },
        { code: 'de', label: 'German (Deutsch)' },
        { code: 'el', label: 'Greek (Ελληνικά)' },
        { code: 'gu', label: 'Gujarati (ગુજરાતી)' },
        { code: 'ht', label: 'Haitian Creole' },
        { code: 'ha', label: 'Hausa' },
        { code: 'he', label: 'Hebrew (עברית)' },
        { code: 'hi', label: 'Hindi (हिन्दी)' },
        { code: 'mww', label: 'Hmong Daw' },
        { code: 'hu', label: 'Hungarian (Magyar)' },
        { code: 'is', label: 'Icelandic (Íslenska)' },
        { code: 'ig', label: 'Igbo (Ásụ̀sụ́ Ìgbò)' },
        { code: 'id', label: 'Indonesian (Indonesia)' },
        { code: 'ikt', label: 'Inuinnaqtun' },
        { code: 'iu-Latn', label: 'Inuktitut (Latin)' },
        { code: 'iu', label: 'Inuktitut (ᐃᓄᒃᑎᑐᑦ)' },
        { code: 'ga', label: 'Irish (Gaeilge)' },
        { code: 'it', label: 'Italian (Italiano)' },
        { code: 'ja', label: 'Japanese (日本語)' },
        { code: 'kn', label: 'Kannada (ಕನ್ನಡ)' },
        { code: 'ks', label: 'Kashmiri (کٲشُر)' },
        { code: 'kk', label: 'Kazakh (Қазақ Тілі)' },
        { code: 'km', label: 'Khmer (ខ្មែរ)' },
        { code: 'rw', label: 'Kinyarwanda' },
        { code: 'tlh-Latn', label: 'Klingon (Latin)' },
        { code: 'tlh-Piqd', label: 'Klingon (pIqaD)' },
        { code: 'gom', label: 'Konkani (कोंकणी)' },
        { code: 'ko', label: 'Korean (한국어)' },
        { code: 'ku', label: 'Kurdish (Central) (Kurdî (Navîn))' },
        { code: 'kmr', label: 'Kurdish (Northern) (Kurdî (Bakur))' },
        { code: 'ky', label: 'Kyrgyz (Кыргызча)' },
        { code: 'lo', label: 'Lao (ລາວ)' },
        { code: 'lv', label: 'Latvian (Latviešu)' },
        { code: 'ln', label: 'Lingala (Lingála)' },
        { code: 'lt', label: 'Lithuanian (Lietuvių)' },
        { code: 'dsb', label: 'Lower Sorbian (Dolnoserbšćina)' },
        { code: 'lb', label: 'Luxembourgish (Lëtzebuergesch)' },
        { code: 'mk', label: 'Macedonian (Македонски)' },
        { code: 'mai', label: 'Maithili (मैथिली)' },
        { code: 'mg', label: 'Malagasy' },
        { code: 'ms', label: 'Malay (Melayu)' },
        { code: 'ml', label: 'Malayalam (മലയാളം)' },
        { code: 'mt', label: 'Maltese (Malti)' },
        { code: 'mni', label: 'Manipuri (ꯃꯩꯇꯩꯂꯣꯟ)' },
        { code: 'mi', label: 'Māori (Te Reo Māori)' },
        { code: 'mr', label: 'Marathi (मराठी)' },
        { code: 'mn-Cyrl', label: 'Mongolian (Cyrillic) (Монгол)' },
        { code: 'mn-Mong', label: 'Mongolian (Traditional) (ᠮᠣᠩᠭᠣᠯ ᠬᠡᠯᠡ)' },
        { code: 'my', label: 'Myanmar (Burmese) (မြန်မာ)' },
        { code: 'ne', label: 'Nepali (नेपाली)' },
        { code: 'nb', label: 'Norwegian (Norsk Bokmål)' },
        { code: 'nya', label: 'Nyanja' },
        { code: 'or', label: 'Odia (ଓଡ଼ିଆ)' },
        { code: 'ps', label: 'Pashto (پښتو)' },
        { code: 'fa', label: 'Persian (فارسی)' },
        { code: 'pl', label: 'Polish (Polski)' },
        { code: 'pt', label: 'Portuguese (Brazil) (Português (Brasil))' },
        { code: 'pt-PT', label: 'Portuguese (Portugal) (Português (Portugal))' },
        { code: 'pa', label: 'Punjabi (ਪੰਜਾਬੀ)' },
        { code: 'otq', label: 'Querétaro Otomi (Hñähñu)' },
        { code: 'ro', label: 'Romanian (Română)' },
        { code: 'run', label: 'Rundi' },
        { code: 'ru', label: 'Russian (Русский)' },
        { code: 'sm', label: 'Samoan (Gagana Sāmoa)' },
        { code: 'sr-Cyrl', label: 'Serbian (Cyrillic) (Српски (ћирилица))' },
        { code: 'sr-Latn', label: 'Serbian (Latin) (Srpski (latinica))' },
        { code: 'st', label: 'Sesotho' },
        { code: 'nso', label: 'Sesotho sa Leboa' },
        { code: 'tn', label: 'Setswana' },
        { code: 'sn', label: 'Shona (chiShona)' },
        { code: 'sd', label: 'Sindhi (سنڌي)' },
        { code: 'si', label: 'Sinhala (සිංහල)' },
        { code: 'sk', label: 'Slovak (Slovenčina)' },
        { code: 'sl', label: 'Slovenian (Slovenščina)' },
        { code: 'so', label: 'Somali (Soomaali)' },
        { code: 'es-MX', label: 'Spanish (Mexico) (Español (México))' },
        { code: 'sw', label: 'Swahili (Kiswahili)' },
        { code: 'sv', label: 'Swedish (Svenska)' },
        { code: 'ty', label: 'Tahitian (Reo Tahiti)' },
        { code: 'ta', label: 'Tamil (தமிழ்)' },
        { code: 'tt', label: 'Tatar (Татар)' },
        { code: 'te', label: 'Telugu (తెలుగు)' },
        { code: 'th', label: 'Thai (ไทย)' },
        { code: 'bo', label: 'Tibetan (བོད་སྐད་)' },
        { code: 'ti', label: 'Tigrinya (ትግር)' },
        { code: 'to', label: 'Tongan (Lea Fakatonga)' },
        { code: 'tr', label: 'Turkish (Türkçe)' },
        { code: 'tk', label: 'Turkmen (Türkmen Dili)' },
        { code: 'uk', label: 'Ukrainian (Українська)' },
        { code: 'hsb', label: 'Upper Sorbian (Hornjoserbšćina)' },
        { code: 'ur', label: 'Urdu (اردو)' },
        { code: 'ug', label: 'Uyghur (ئۇيغۇرچە)' },
        { code: 'uz', label: 'Uzbek (Latin) (O‘Zbek)' },
        { code: 'vi', label: 'Vietnamese (Tiếng Việt)' },
        { code: 'cy', label: 'Welsh (Cymraeg)' },
        { code: 'xh', label: 'Xhosa (isiXhosa)' },
        { code: 'yo', label: 'Yoruba (Èdè Yorùbá)' },
        { code: 'yua', label: 'Yucatec Maya' },
        { code: 'zu', label: 'Zulu (Isi-Zulu)' },
    ]);
    const BING_LANGUAGE_CODES = new Set(BING_LANGUAGE_OPTIONS.map(option => option.code));
    const BING_LANGUAGE_CODE_LOOKUP = new Map(BING_LANGUAGE_OPTIONS.map(option => [option.code.toLowerCase(), option.code]));
    const OUTGOING_LANGUAGE_OPTIONS = Object.freeze([
        ...BING_LANGUAGE_OPTIONS.filter(option => option.code === 'en'),
        ...BING_LANGUAGE_OPTIONS.filter(option => option.code === 'es'),
        ...BING_LANGUAGE_OPTIONS.filter(option => option.code !== 'auto' && option.code !== 'en' && option.code !== 'es'),
    ]);

    function log(...args) {
        if (CONFIG.debug) {
            console.debug('[qtranslate-script]', ...args);
        }
    }

    function truncateTelemetryString(value, limit = CONFIG.telemetry.maxStringLength) {
        const normalized = String(value ?? '');
        if (normalized.length <= limit) return normalized;
        return `${normalized.slice(0, limit)}...<truncated:${normalized.length - limit}>`;
    }

    function sanitizeTelemetryValue(value, depth = 0) {
        if (value == null || typeof value === 'number' || typeof value === 'boolean') {
            return value;
        }
        if (typeof value === 'string') {
            return truncateTelemetryString(value);
        }
        if (value instanceof Error) {
            return {
                name: value.name,
                message: truncateTelemetryString(value.message || ''),
                stack: truncateTelemetryString(value.stack || ''),
            };
        }
        if (value instanceof HTMLElement) {
            return {
                tagName: value.tagName,
                id: value.id || null,
                className: truncateTelemetryString(value.className || '', 250),
                dataset: sanitizeTelemetryValue({ ...(value.dataset || {}) }, depth + 1),
                text: truncateTelemetryString(value.textContent || '', 250),
            };
        }
        if (value instanceof Node) {
            return {
                nodeType: value.nodeType,
                text: truncateTelemetryString(value.textContent || '', 250),
            };
        }
        if (depth >= CONFIG.telemetry.maxPayloadDepth) {
            return '[max-depth]';
        }
        if (Array.isArray(value)) {
            return value
                .slice(0, CONFIG.telemetry.maxArrayItems)
                .map(item => sanitizeTelemetryValue(item, depth + 1));
        }
        if (value instanceof Map) {
            return {
                type: 'Map',
                entries: [...value.entries()]
                    .slice(0, CONFIG.telemetry.maxArrayItems)
                    .map(([key, entryValue]) => [sanitizeTelemetryValue(key, depth + 1), sanitizeTelemetryValue(entryValue, depth + 1)]),
            };
        }
        if (value instanceof Set) {
            return {
                type: 'Set',
                values: [...value.values()]
                    .slice(0, CONFIG.telemetry.maxArrayItems)
                    .map(item => sanitizeTelemetryValue(item, depth + 1)),
            };
        }
        if (typeof value === 'object') {
            return Object.fromEntries(
                Object.entries(value)
                    .slice(0, CONFIG.telemetry.maxArrayItems)
                    .map(([key, entryValue]) => [key, sanitizeTelemetryValue(entryValue, depth + 1)])
            );
        }
        return truncateTelemetryString(String(value));
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function safeJsonParse(value, fallback) {
        try {
            return JSON.parse(value);
        } catch {
            return fallback;
        }
    }

    function truncateDomSnapshotString(value, limit) {
        return truncateTelemetryString(
            String(value ?? '').replace(/\s+/g, ' ').trim(),
            limit
        );
    }

    function describeDomNode(node) {
        if (!(node instanceof Element)) return null;
        return {
            tagName: node.tagName.toLowerCase(),
            id: node.id || null,
            className: truncateDomSnapshotString(node.className || '', 300),
            ariaLabel: truncateDomSnapshotString(node.getAttribute('aria-label') || '', 180),
            role: truncateDomSnapshotString(node.getAttribute('role') || '', 80),
            dataset: sanitizeTelemetryValue({ ...(node.dataset || {}) }),
            textPreview: truncateDomSnapshotString(node.textContent || '', CONFIG.telemetry.domSnapshotMaxTextLength),
            childElementCount: node.childElementCount,
        };
    }

    function serializeDomNode(node) {
        if (!(node instanceof Element)) return null;
        return {
            descriptor: describeDomNode(node),
            html: truncateDomSnapshotString(node.outerHTML || '', CONFIG.telemetry.domSnapshotMaxHtmlLength),
        };
    }

    /**
     * Extrae un "snapshot" (instantánea) de una parte del DOM de forma segura y truncada,
     * útil para enviarlo por telemetría cuando falla un selector.
     */
    function captureDomSnapshot(signature, primaryNode, options = {}) {
        const node = primaryNode instanceof Element
            ? primaryNode
            : options.fallbackNode instanceof Element
                ? options.fallbackNode
                : null;
        if (!node) return null;

        const fingerprintSource = [
            signature,
            node.tagName,
            node.id,
            node.className,
            truncateDomSnapshotString(node.textContent || '', 120),
        ].join('|');
        const fingerprint = truncateTelemetryString(fingerprintSource, 500);
        const previousCapture = DOM_SNAPSHOT_CAPTURE_STATE.get(fingerprint) || 0;
        const now = Date.now();
        if (!options.ignoreCooldown && now - previousCapture < CONFIG.telemetry.domSnapshotCooldownMs) {
            return {
                skipped: true,
                reason: 'cooldown',
                cooldownMs: CONFIG.telemetry.domSnapshotCooldownMs,
                fingerprint,
            };
        }
        DOM_SNAPSHOT_CAPTURE_STATE.set(fingerprint, now);

        const relatives = [];
        if (options.includeParent !== false && node.parentElement) {
            relatives.push({
                relation: 'parent',
                ...serializeDomNode(node.parentElement),
            });
        }
        if (options.includePrevSibling && node.previousElementSibling) {
            relatives.push({
                relation: 'previousSibling',
                ...serializeDomNode(node.previousElementSibling),
            });
        }
        if (options.includeNextSibling && node.nextElementSibling) {
            relatives.push({
                relation: 'nextSibling',
                ...serializeDomNode(node.nextElementSibling),
            });
        }

        return {
            signature,
            fingerprint,
            descriptor: describeDomNode(node),
            html: truncateDomSnapshotString(node.outerHTML || '', CONFIG.telemetry.domSnapshotMaxHtmlLength),
            relatives,
            extra: sanitizeTelemetryValue(options.extra || {}),
        };
    }

    function getStoredTelemetryRecordingState() {
        const parsed = safeJsonParse(localStorage.getItem(TELEMETRY_RECORDING_STORAGE_KEY), null);
        if (!parsed || typeof parsed !== 'object') return null;
        if (!parsed.active || Number(parsed.until || 0) <= Date.now()) return null;
        return parsed;
    }

    function setStoredTelemetryRecordingState(state) {
        try {
            if (!state) {
                localStorage.removeItem(TELEMETRY_RECORDING_STORAGE_KEY);
                return;
            }
            localStorage.setItem(TELEMETRY_RECORDING_STORAGE_KEY, JSON.stringify(state));
        } catch (error) {
            log('Failed to persist telemetry recording state', error);
        }
    }

    function collectTelemetryRecordingDomState() {
        const selectorEntries = [
            ['pmContainer', '#ChatTabContents.TheatermodeChatDivPm, .ChatTabContents.TheatermodeChatDivPm, .TheatermodeChatDivPm'],
            ['chatTabContainer', '#ChatTabContainer'],
            ['roomTabs', '#roomTabs'],
            ['pmControlBar', '#pm-control-bar, .PMControlBar.pm-control-bar'],
            ['messageList', '.msg-list-fvm.message-list, .message-list, [class*="message-list"]'],
            ['stripchatMessenger', '.expanded.messenger-chat, .messenger-chat'],
            ['stripchatControls', '.chat-controls.content-controls'],
            ['stripchatMessages', '.content-messages'],
            ['composerInput', 'textarea.ChatInput__input, .theatermodeInputFieldPm, textarea[placeholder*="Private message"], textarea[placeholder*="Mensaje privado"]'],
            ['sendButton', '.ChatInput__sendBtn, [data-testid="send-button"], button[aria-label="Enviar"], button[aria-label="Send"]'],
        ];

        return {
            readyState: document.readyState,
            visibilityState: document.visibilityState,
            href: location.href,
            title: document.title,
            activeElement: describeDomNode(document.activeElement instanceof Element ? document.activeElement : null),
            selectorState: selectorEntries.map(([key, selector]) => {
                const nodes = [...document.querySelectorAll(selector)];
                return {
                    key,
                    selector,
                    count: nodes.length,
                    sample: serializeDomNode(nodes[0] || null),
                };
            }),
            bodySummary: describeDomNode(document.body),
        };
    }

    function getOrCreateTelemetryInstallId() {
        const existing = localStorage.getItem(TELEMETRY_INSTALL_ID_STORAGE_KEY);
        if (typeof existing === 'string' && existing.trim()) {
            return existing.trim();
        }

        const created = `qts-install-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
        localStorage.setItem(TELEMETRY_INSTALL_ID_STORAGE_KEY, created);
        return created;
    }

    function bytesToBase64(bytes) {
        const chunkSize = 0x8000;
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
        }
        return btoa(binary);
    }

    function base64ToBytes(value) {
        const binary = atob(value || '');
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }
        return bytes;
    }

    function gmGetJson(key, fallback) {
        try {
            if (typeof GM_getValue !== 'function') return fallback;
            const value = GM_getValue(key, null);
            if (typeof value !== 'string' || !value) return fallback;
            return safeJsonParse(value, fallback);
        } catch {
            return fallback;
        }
    }

    function gmSetJson(key, value) {
        try {
            if (typeof GM_setValue !== 'function') return;
            GM_setValue(key, JSON.stringify(value));
        } catch (error) {
            log('Failed to write Tampermonkey storage value', { key, error });
        }
    }

    function gmDeleteKey(key) {
        try {
            if (typeof GM_deleteValue !== 'function') return;
            GM_deleteValue(key);
        } catch (error) {
            log('Failed to delete Tampermonkey storage value', { key, error });
        }
    }

    function gmListKeys() {
        try {
            return typeof GM_listValues === 'function' ? GM_listValues() : [];
        } catch {
            return [];
        }
    }

    /**
     * Cliente de Telemetría.
     * Se encarga de capturar eventos, errores y el estado del DOM, encolarlos
     * y enviarlos por lotes (batches) al servidor de depuración configurado.
     */
    class TelemetryClient {
        constructor() {
            this.queue = [];
            this.flushTimer = null;
            this.isFlushing = false;
            this.globalHandlersInstalled = false;
            this.recordingInterval = null;
            this.recordingStopTimer = null;
            this.recordingUntil = 0;
            this.recordingActive = false;
            this.lastRecordingMutationAt = 0;
        }

        start() {
            if (this.flushTimer) return;
            this.installGlobalHandlers();
            this.flushTimer = setInterval(() => {
                this.flush('interval').catch(() => {});
            }, CONFIG.telemetry.flushIntervalMs);
            this.capture('telemetry.started', {
                installId: TELEMETRY_INSTALL_ID,
                sessionId: TELEMETRY_SESSION_ID,
                configuredEndpoint: this.getEndpoint(),
                href: location.href,
                userAgent: navigator.userAgent,
            }, 'info');
            const restoredRecordingState = getStoredTelemetryRecordingState();
            if (restoredRecordingState) {
                this.startRecording('restored', {
                    until: Number(restoredRecordingState.until),
                    restored: true,
                    origin: restoredRecordingState.origin || null,
                });
            }
        }

        installGlobalHandlers() {
            if (this.globalHandlersInstalled) return;
            this.globalHandlersInstalled = true;

            window.addEventListener('error', event => {
                this.capture('runtime.error', {
                    message: event.message,
                    filename: event.filename,
                    lineno: event.lineno,
                    colno: event.colno,
                    error: event.error,
                }, 'error');
            });

            window.addEventListener('unhandledrejection', event => {
                this.capture('runtime.unhandledrejection', {
                    reason: event.reason,
                }, 'error');
            });

            window.addEventListener('beforeunload', () => {
                this.flush('beforeunload').catch(() => {});
            });
        }

        getEndpoint() {
            const runtimeOverride = window.__QTS_TELEMETRY_ENDPOINT;
            if (typeof runtimeOverride === 'string' && runtimeOverride.trim()) {
                return runtimeOverride.trim();
            }

            const stored = localStorage.getItem(CONFIG.telemetry.endpointStorageKey);
            if (typeof stored === 'string' && stored.trim()) {
                return stored.trim();
            }

            return CONFIG.telemetry.endpoint || '';
        }

        isRecording() {
            return this.recordingActive && this.recordingUntil > Date.now();
        }

        getRecordingRemainingMs() {
            return Math.max(0, this.recordingUntil - Date.now());
        }

        notifyRecordingStateChanged() {
            window.dispatchEvent(new CustomEvent('qts-telemetry-recording-changed', {
                detail: {
                    active: this.isRecording(),
                    remainingMs: this.getRecordingRemainingMs(),
                    until: this.recordingUntil || 0,
                },
            }));
        }

        recordDetailedSnapshot(source, extra = {}, level = 'info') {
            if (!this.isRecording()) return;
            this.capture('telemetry.recording.snapshot', {
                source,
                remainingMs: this.getRecordingRemainingMs(),
                domState: collectTelemetryRecordingDomState(),
                domSnapshot: captureDomSnapshot(`recording:${source}`, document.body, {
                    includeParent: false,
                    ignoreCooldown: true,
                    extra,
                }),
                extra,
            }, level);
        }

        captureRecordingMutation(source, extra = {}) {
            if (!this.isRecording()) return;
            const now = Date.now();
            if (now - this.lastRecordingMutationAt < CONFIG.telemetry.recordingMutationThrottleMs) {
                return;
            }
            this.lastRecordingMutationAt = now;
            this.recordDetailedSnapshot(source, extra, 'info');
        }

        startRecording(reason = 'manual', options = {}) {
            const requestedUntil = Number(options.until || 0);
            const until = requestedUntil > Date.now()
                ? requestedUntil
                : Date.now() + CONFIG.telemetry.recordingDurationMs;

            if (this.recordingInterval) clearInterval(this.recordingInterval);
            if (this.recordingStopTimer) clearTimeout(this.recordingStopTimer);

            this.recordingActive = true;
            this.recordingUntil = until;
            this.lastRecordingMutationAt = 0;

            setStoredTelemetryRecordingState({
                active: true,
                until,
                origin: options.origin || location.href,
                startedAt: Date.now(),
            });

            this.capture('telemetry.recording.started', {
                reason,
                restored: Boolean(options.restored),
                until: new Date(until).toISOString(),
                durationMs: until - Date.now(),
                domState: collectTelemetryRecordingDomState(),
            }, 'info');
            this.recordDetailedSnapshot('recording-start', {
                reason,
                restored: Boolean(options.restored),
            });

            this.recordingInterval = setInterval(() => {
                this.recordDetailedSnapshot('recording-interval');
            }, CONFIG.telemetry.recordingSnapshotIntervalMs);

            this.recordingStopTimer = setTimeout(() => {
                this.stopRecording('timeout');
            }, Math.max(0, until - Date.now()));

            this.notifyRecordingStateChanged();
        }

        stopRecording(reason = 'manual') {
            const wasActive = this.recordingActive;
            const remainingMs = this.getRecordingRemainingMs();

            if (this.recordingInterval) {
                clearInterval(this.recordingInterval);
                this.recordingInterval = null;
            }
            if (this.recordingStopTimer) {
                clearTimeout(this.recordingStopTimer);
                this.recordingStopTimer = null;
            }

            this.recordingActive = false;
            this.recordingUntil = 0;
            this.lastRecordingMutationAt = 0;
            setStoredTelemetryRecordingState(null);

            if (wasActive) {
                this.capture('telemetry.recording.stopped', {
                    reason,
                    remainingMs,
                    domState: collectTelemetryRecordingDomState(),
                }, 'info');
                this.flush(`recording-stop:${reason}`).catch(() => {});
            }

            this.notifyRecordingStateChanged();
        }

        capture(event, payload = {}, level = 'debug') {
            if (!CONFIG.telemetry.enabled) return;

            const entry = {
                id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
                ts: new Date().toISOString(),
                installId: TELEMETRY_INSTALL_ID,
                sessionId: TELEMETRY_SESSION_ID,
                level,
                event,
                page: {
                    href: location.href,
                    host: location.hostname,
                    title: document.title,
                },
                recording: {
                    active: this.isRecording(),
                    remainingMs: this.getRecordingRemainingMs(),
                },
                payload: sanitizeTelemetryValue(payload),
            };

            this.queue.push(entry);
            if (this.queue.length > CONFIG.telemetry.maxQueueSize) {
                // console.warn(`[qtranslate-script] Telemetry queue overflow, dropping ${this.queue.length - CONFIG.telemetry.maxQueueSize} events`);
                this.queue.splice(0, this.queue.length - CONFIG.telemetry.maxQueueSize);
            }

            if (CONFIG.telemetry.mirrorConsole) {
                const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'debug';
                console[method]('[qtranslate-telemetry]', event, entry.payload);
            }

            if (this.queue.length >= CONFIG.telemetry.batchSize) {
                this.flush('threshold').catch(() => {});
            }
        }

        async flush(reason = 'manual') {
            const endpoint = this.getEndpoint();
            if (!endpoint || this.isFlushing || !this.queue.length || typeof GM_xmlhttpRequest !== 'function') {
                return;
            }

            this.isFlushing = true;
            const batch = this.queue.splice(0, CONFIG.telemetry.batchSize);

            try {
                await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'POST',
                        url: endpoint,
                        headers: {
                            'Content-Type': 'application/json',
                            Accept: 'application/json, text/plain, */*',
                        },
                        data: JSON.stringify({
                            reason,
                            sentAt: new Date().toISOString(),
                            installId: TELEMETRY_INSTALL_ID,
                            sessionId: TELEMETRY_SESSION_ID,
                            events: batch,
                        }),
                        timeout: CONFIG.telemetry.requestTimeoutMs,
                        onload: response => {
                            if (response.status >= 200 && response.status < 300) {
                                resolve(response);
                            } else {
                                reject(new Error(`Telemetry HTTP ${response.status}: ${response.responseText}`));
                            }
                        },
                        onerror: reject,
                        ontimeout: () => reject(new Error('Telemetry request timed out')),
                    });
                });
            } catch (error) {
                this.queue.unshift(...batch);
                console.error('[qtranslate-telemetry] flush failed', error);
            } finally {
                this.isFlushing = false;
            }
        }
    }

    const telemetry = new TelemetryClient();

    function loadState() {
        const rawValue = localStorage.getItem(STORAGE_KEY);
        telemetry.capture('state.load', {
            storageKey: STORAGE_KEY,
            hasValue: typeof rawValue === 'string' && rawValue.length > 0,
            rawLength: rawValue?.length || 0,
        });
        const parsed = safeJsonParse(rawValue, null);
        if (!parsed || typeof parsed !== 'object') {
            telemetry.capture('state.load.defaulted', {
                reason: 'missing-or-invalid',
            }, 'warn');
            return {
                sites: {},
                settings: {
                    translationEnabled: false,
                    outgoingTranslationEnabled: false,
                    targetLanguage: CONFIG.targetLanguage,
                    outgoingTargetLanguage: CONFIG.outgoingTargetLanguage,
                },
            };
        }
        if (typeof parsed.sites !== 'object' || parsed.sites === null) {
            parsed.sites = {};
        }
        parsed.settings = {
            translationEnabled: false,
            outgoingTranslationEnabled: false,
            targetLanguage: CONFIG.targetLanguage,
            outgoingTargetLanguage: CONFIG.outgoingTargetLanguage,
        };
        telemetry.capture('state.load.success', {
            siteCount: Object.keys(parsed.sites || {}).length,
            settings: parsed.settings,
        });
        return parsed;
    }

    function saveState(state) {
        const serialized = JSON.stringify(state);
        localStorage.setItem(STORAGE_KEY, serialized);
        telemetry.capture('state.save', {
            storageKey: STORAGE_KEY,
            serializedLength: serialized.length,
            state,
        });
    }

    function getSiteState(state, siteId) {
        state.sites[siteId] ??= { users: {} };
        return state.sites[siteId];
    }

    function createDefaultConversationSettings() {
        return {
            translationEnabled: false,
            outgoingTranslationEnabled: false,
            targetLanguage: CONFIG.targetLanguage,
            outgoingTargetLanguage: CONFIG.outgoingTargetLanguage,
        };
    }

    function isTranslationEnabled(state) {
        return state?.settings?.translationEnabled === true;
    }

    function setTranslationEnabled(state, enabled) {
        state.settings ??= {};
        state.settings.translationEnabled = enabled;
        telemetry.capture('settings.translationEnabled.changed', {
            enabled,
        }, 'info');
        saveState(state);
    }

    function isOutgoingTranslationEnabled(state) {
        return state?.settings?.outgoingTranslationEnabled !== false;
    }

    function setOutgoingTranslationEnabled(state, enabled) {
        state.settings ??= {};
        state.settings.outgoingTranslationEnabled = enabled;
        telemetry.capture('settings.outgoingTranslationEnabled.changed', {
            enabled,
        }, 'info');
        saveState(state);
    }

    function isSupportedTargetLanguage(code) {
        return typeof code === 'string' && BING_LANGUAGE_CODES.has(code);
    }

    function isSupportedOutgoingTargetLanguage(code) {
        return typeof code === 'string' && code !== 'auto' && BING_LANGUAGE_CODES.has(code);
    }

    function normalizeLanguageCandidate(code) {
        return String(code || '').trim().replace(/_/g, '-').toLowerCase();
    }

    function findSupportedLanguageCode(candidate) {
        const normalized = normalizeLanguageCandidate(candidate);
        if (!normalized) return null;

        const exact = BING_LANGUAGE_CODE_LOOKUP.get(normalized);
        if (exact) return exact;

        const base = normalized.split('-')[0];
        return BING_LANGUAGE_CODE_LOOKUP.get(base) || null;
    }

    function getConfiguredTargetLanguage(state) {
        const configured = state?.settings?.targetLanguage;
        return isSupportedTargetLanguage(configured) ? configured : CONFIG.targetLanguage;
    }

    function getConfiguredOutgoingTargetLanguage(state) {
        const configured = state?.settings?.outgoingTargetLanguage;
        return isSupportedOutgoingTargetLanguage(configured) ? configured : CONFIG.outgoingTargetLanguage;
    }

    function resolveAutoTargetLanguage() {
        const candidates = [
            ...(Array.isArray(navigator.languages) ? navigator.languages : []),
            navigator.language,
            CONFIG.targetLanguage,
        ];

        for (const candidate of candidates) {
            const resolved = findSupportedLanguageCode(candidate);
            if (resolved && resolved !== 'auto') {
                return resolved;
            }
        }

        return CONFIG.targetLanguage;
    }

    function getEffectiveTargetLanguage(state) {
        const configured = getConfiguredTargetLanguage(state);
        return configured === 'auto' ? resolveAutoTargetLanguage() : configured;
    }

    function getTargetLanguageLabel(code) {
        return BING_LANGUAGE_OPTIONS.find(option => option.code === code)?.label || code;
    }

    function setTargetLanguage(state, targetLanguage) {
        state.settings ??= {};
        state.settings.targetLanguage = isSupportedTargetLanguage(targetLanguage)
            ? targetLanguage
            : CONFIG.targetLanguage;
        telemetry.capture('settings.targetLanguage.changed', {
            requested: targetLanguage,
            stored: state.settings.targetLanguage,
        }, 'info');
        saveState(state);
    }

    function setOutgoingTargetLanguage(state, targetLanguage) {
        state.settings ??= {};
        state.settings.outgoingTargetLanguage = isSupportedOutgoingTargetLanguage(targetLanguage)
            ? targetLanguage
            : CONFIG.outgoingTargetLanguage;
        telemetry.capture('settings.outgoingTargetLanguage.changed', {
            requested: targetLanguage,
            stored: state.settings.outgoingTargetLanguage,
        }, 'info');
        saveState(state);
    }

    /**
     * Inyecta los estilos CSS necesarios en la página (solo si no existen).
     * Incluye animaciones, opacidad, diseño de menús y estados de error.
     */
    function ensureStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .${TRANSLATION_BLOCK_CLASS} {
                display: inline;
            }
            .${TRANSLATION_BLOCK_CLASS}[data-status="pending"] {
                opacity: 0.68;
            }
            [data-testid="chat-message-text"][data-qts-pending="1"] {
                opacity: 0.72;
            }
            [data-qts-message-content="1"] {
                white-space: pre-wrap;
            }
            .translation-toggle-container[data-qts-toggle="1"] {
                display: inline-flex;
                margin-left: 6px;
                vertical-align: text-bottom;
            }
            .translation-toggle-container[data-qts-toggle="1"] > button {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 18px;
                min-width: 18px;
                height: 18px;
                padding: 0;
                border: 0;
                border-radius: 999px;
                background: transparent;
                box-shadow: none;
                color: inherit;
                opacity: 0.86;
            }
            .translation-toggle-container[data-qts-toggle="1"] > button:hover,
            .translation-toggle-container[data-qts-toggle="1"] > button:focus {
                background: transparent;
                box-shadow: none;
                opacity: 1;
            }
            .translation-toggle-container[data-qts-toggle="1"] > button svg {
                display: block;
            }
            [data-qts-status="1"] {
                display: inline;
                margin-left: 6px;
                font-size: 10px;
                line-height: 1;
                opacity: 0.88;
            }
            [data-qts-status-type="error"] {
                color: #ff6b6b;
            }
            [data-qts-composer-status="1"] {
                display: block;
                margin-top: 4px;
                font-size: 10px;
                line-height: 1.2;
                opacity: 0.9;
            }
            [data-qts-composer-status-type="error"] {
                color: #ff6b6b;
            }
            [data-qts-composer-busy="1"] {
                opacity: 0.72;
                pointer-events: none;
            }
            [data-qts-send-busy="1"] {
                opacity: 0.72;
                pointer-events: none;
            }
            [data-qts-backlog-progress="1"] {
                display: block;
                margin-top: 8px;
                padding: 6px 8px;
                border-radius: 6px;
                background: rgba(255, 255, 255, 0.04);
            }
            [data-qts-backlog-label="1"] {
                font-size: 11px;
                line-height: 1.2;
                color: rgba(255, 255, 255, 0.76);
            }
            [data-qts-backlog-dots="1"] {
                display: inline-flex;
                align-items: center;
                gap: 4px;
                margin-left: 6px;
                vertical-align: middle;
            }
            [data-qts-backlog-dot="1"] {
                width: 4px;
                height: 4px;
                border-radius: 999px;
                background: #2fbcff;
                opacity: 0.28;
                animation: qts-backlog-pulse 1s ease-in-out infinite;
            }
            [data-qts-backlog-dot="1"]:nth-child(2) {
                animation-delay: 0.18s;
            }
            [data-qts-backlog-dot="1"]:nth-child(3) {
                animation-delay: 0.36s;
            }
            @keyframes qts-backlog-pulse {
                0%, 80%, 100% {
                    opacity: 0.28;
                    transform: scale(0.85);
                }
                40% {
                    opacity: 1;
                    transform: scale(1);
                }
            }
            [data-qts-pm-toggle-wrap="1"] {
                margin-left: auto;
                margin-right: 8px;
                display: inline-flex;
                align-items: center;
                gap: 8px;
            }
            [data-qts-outgoing-language-wrap="1"] {
                display: flex;
                align-items: center;
                justify-content: flex-end;
                gap: 8px;
                margin: 10px 14px 0;
                padding: 0 8px;
            }
            [data-qts-outgoing-language-label="1"] {
                font-size: 11px;
                line-height: 1;
                opacity: 0.72;
                white-space: nowrap;
            }
            [data-qts-pm-target-select="1"] {
                max-width: 170px;
                height: 22px;
                padding: 0 24px 0 8px;
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 999px;
                background: rgba(0, 0, 0, 0.2);
                color: inherit;
                font-size: 11px;
                line-height: 20px;
                outline: none;
                cursor: pointer;
                appearance: none;
                -webkit-appearance: none;
                background-image:
                    linear-gradient(45deg, transparent 50%, rgba(255, 255, 255, 0.82) 50%),
                    linear-gradient(135deg, rgba(255, 255, 255, 0.82) 50%, transparent 50%);
                background-position:
                    calc(100% - 13px) 9px,
                    calc(100% - 8px) 9px;
                background-size: 5px 5px, 5px 5px;
                background-repeat: no-repeat;
            }
            [data-qts-pm-target-select="1"]:hover,
            [data-qts-pm-target-select="1"]:focus {
                border-color: rgba(47, 188, 255, 0.6);
                background-color: rgba(0, 119, 159, 0.12);
            }
            [data-qts-pm-target-select="1"] option {
                color: #111;
            }
            [data-qts-outgoing-language-select="1"] {
                min-width: 170px;
                max-width: 220px;
                height: 24px;
                padding: 0 24px 0 8px;
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 999px;
                background: rgba(0, 0, 0, 0.2);
                color: inherit;
                font-size: 11px;
                line-height: 22px;
                outline: none;
                cursor: pointer;
                appearance: none;
                -webkit-appearance: none;
                background-image:
                    linear-gradient(45deg, transparent 50%, rgba(255, 255, 255, 0.82) 50%),
                    linear-gradient(135deg, rgba(255, 255, 255, 0.82) 50%, transparent 50%);
                background-position:
                    calc(100% - 13px) 10px,
                    calc(100% - 8px) 10px;
                background-size: 5px 5px, 5px 5px;
                background-repeat: no-repeat;
            }
            [data-qts-outgoing-language-select="1"]:hover,
            [data-qts-outgoing-language-select="1"]:focus {
                border-color: rgba(47, 188, 255, 0.6);
                background-color: rgba(0, 119, 159, 0.12);
            }
            [data-qts-outgoing-language-select="1"] option {
                color: #111;
            }
            [data-qts-pm-outgoing-toggle="1"] {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 22px;
                min-width: 22px;
                height: 22px;
                margin-right: 6px;
                border: 1px solid rgba(255, 255, 255, 0.16);
                border-radius: 999px;
                padding: 0;
                background: rgba(0, 0, 0, 0.16);
                color: inherit;
                opacity: 1;
                cursor: pointer;
                transition: background-color 120ms ease, border-color 120ms ease, opacity 120ms ease, transform 120ms ease;
            }
            [data-qts-pm-outgoing-toggle="1"] svg {
                width: 14px;
                height: 14px;
                opacity: 0.42;
                filter: grayscale(1) saturate(0) brightness(1.25);
            }
            [data-qts-pm-outgoing-toggle="1"]:hover {
                background: rgba(255, 255, 255, 0.08);
            }
            [data-qts-pm-outgoing-toggle="1"][aria-pressed="true"] {
                border-color: rgba(47, 188, 255, 0.72);
                background: rgba(0, 119, 159, 0.18);
                box-shadow: inset 0 0 0 1px rgba(47, 188, 255, 0.18);
            }
            [data-qts-pm-outgoing-toggle="1"][aria-pressed="true"] svg {
                opacity: 1;
                filter: none;
            }
            [data-qts-pm-toggle-button="1"] {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 22px;
                height: 22px;
                padding: 0;
                border: 1px solid rgba(255, 255, 255, 0.16);
                border-radius: 999px;
                background: rgba(0, 0, 0, 0.16);
                color: inherit;
                cursor: pointer;
                transition: background-color 120ms ease, border-color 120ms ease, opacity 120ms ease, transform 120ms ease;
            }
            [data-qts-pm-toggle-button="1"] svg {
                width: 14px;
                height: 14px;
                opacity: 0.42;
                filter: grayscale(1) saturate(0) brightness(1.25);
            }
            [data-qts-pm-toggle-button="1"]:hover {
                background: rgba(255, 255, 255, 0.08);
            }
            [data-qts-pm-toggle-button="1"][aria-pressed="true"] {
                border-color: rgba(47, 188, 255, 0.72);
                background: rgba(0, 119, 159, 0.18);
                box-shadow: inset 0 0 0 1px rgba(47, 188, 255, 0.18);
            }
            [data-qts-pm-toggle-button="1"][aria-pressed="true"] svg {
                opacity: 1;
                filter: none;
            }
            [data-qts-recording-button="1"] {
                position: fixed;
                right: 14px;
                bottom: 14px;
                z-index: 2147483647;
                display: inline-flex;
                align-items: center;
                gap: 8px;
                min-height: 34px;
                padding: 0 12px;
                border: 1px solid rgba(255, 255, 255, 0.18);
                border-radius: 999px;
                background: rgba(19, 23, 32, 0.88);
                color: #fff;
                font-size: 12px;
                line-height: 1;
                cursor: pointer;
                box-shadow: 0 8px 26px rgba(0, 0, 0, 0.28);
                backdrop-filter: blur(10px);
            }
            [data-qts-recording-button="1"]:hover {
                background: rgba(28, 35, 48, 0.96);
            }
            [data-qts-recording-dot="1"] {
                width: 8px;
                height: 8px;
                border-radius: 999px;
                background: #6f7c8f;
                flex: 0 0 auto;
            }
            [data-qts-recording-button="1"][data-active="true"] {
                border-color: rgba(255, 90, 90, 0.62);
                background: rgba(66, 14, 20, 0.92);
            }
            [data-qts-recording-button="1"][data-active="true"] [data-qts-recording-dot="1"] {
                background: #ff6262;
                box-shadow: 0 0 0 0 rgba(255, 98, 98, 0.6);
                animation: qts-recording-pulse 1.2s ease-in-out infinite;
            }
            @keyframes qts-recording-pulse {
                0% {
                    box-shadow: 0 0 0 0 rgba(255, 98, 98, 0.6);
                }
                70% {
                    box-shadow: 0 0 0 8px rgba(255, 98, 98, 0);
                }
                100% {
                    box-shadow: 0 0 0 0 rgba(255, 98, 98, 0);
                }
            }
        `;
        document.head.appendChild(style);
    }

    function normalizeWhitespace(text) {
        return (text || '').replace(/\s+/g, ' ').trim();
    }

    function extractMessageTextFromNode(textNode) {
        if (!textNode) return '';

        const preserved = textNode.dataset.qtsOriginalText
            || textNode.querySelector('[data-qts-message-content="1"]')?.textContent;
        if (preserved) {
            return normalizeWhitespace(preserved);
        }

        const clone = textNode.cloneNode(true);
        clone.querySelectorAll(
            '.message-indicators, .translation-toggle-container, [data-qts-status="1"], [data-qts-backlog-progress="1"], .chat-message-translate-button'
        ).forEach(node => node.remove());

        return normalizeWhitespace(clone.textContent || '');
    }

    function markerFor(index) {
        return `${MARKER_PREFIX}${String(index).padStart(4, '0')}${MARKER_SUFFIX}`;
    }

    function splitTranslatedBatch(text, expectedCount) {
        const regex = /\[\[QTS_MSG_(\d{4})\]\]/g;
        const endIndex = text.indexOf(END_MARKER);
        const normalized = endIndex >= 0 ? text.slice(0, endIndex) : text;
        const parts = normalized.split(regex);

        if (parts.length < 3) return null;

        const results = new Array(expectedCount).fill('');
        for (let i = 1; i < parts.length; i += 2) {
            const idx = Number(parts[i]);
            if (!Number.isInteger(idx) || idx < 0 || idx >= expectedCount) continue;
            results[idx] = (parts[i + 1] || '').trim();
        }

        if (results.some(part => !part)) return null;
        return results;
    }

    function buildMessageId(message) {
        return `${message.authorName}::${message.timestamp || '0'}::${message.text}`;
    }

    function buildOutgoingMessageKey(conversationKey, timestamp) {
        if (!conversationKey || !timestamp) return null;
        return `${conversationKey}::${timestamp}`;
    }

    function buildIncomingSettingsKey(siteId = 'global', conversationKey = 'default') {
        return `${siteId}::incoming-settings::${conversationKey}`;
    }

    function buildDetectedLanguageKey(siteId, authorKey) {
        if (!siteId || !authorKey) return null;
        return `${siteId}::${authorKey}`;
    }

    function hashString(value) {
        let hash = 2166136261;
        const input = String(value || '');
        for (let index = 0; index < input.length; index += 1) {
            hash ^= input.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    function buildTranslationCacheKey(sourceLanguage, targetLanguage, text) {
        const normalizedSourceLanguage = String(sourceLanguage || CONFIG.sourceLanguage || 'auto').toLowerCase();
        const normalizedTargetLanguage = String(targetLanguage || CONFIG.targetLanguage || 'auto').toLowerCase();
        const normalizedText = normalizeWhitespace(text || '');
        if (!normalizedText) return null;
        return [
            normalizedSourceLanguage,
            normalizedTargetLanguage,
            normalizedText.length,
            hashString(normalizedText),
        ].join('::');
    }

    /**
     * Almacenamiento en IndexedDB.
     * Gestiona la persistencia de configuración por chat, la caché de traducciones
     * para no saturar la API de traduccion remota, y el registro de mensajes enviados.
     */
    class OutgoingMessageStore {
        constructor() {
            this.dbPromise = null;
            this.cryptoKeyCache = new Map();
        }

        async open() {
            if (!window.indexedDB) {
                telemetry.capture('db.open.unavailable', {
                    dbName: OUTGOING_MESSAGE_DB_NAME,
                }, 'error');
                return null;
            }

            if (!this.dbPromise) {
                telemetry.capture('db.open.start', {
                    dbName: OUTGOING_MESSAGE_DB_NAME,
                    version: OUTGOING_MESSAGE_DB_VERSION,
                }, 'info');
                this.dbPromise = new Promise((resolve, reject) => {
                    const request = indexedDB.open(OUTGOING_MESSAGE_DB_NAME, OUTGOING_MESSAGE_DB_VERSION);

                    request.onupgradeneeded = () => {
                        const db = request.result;
                        telemetry.capture('db.open.upgradeNeeded', {
                            dbName: OUTGOING_MESSAGE_DB_NAME,
                            version: OUTGOING_MESSAGE_DB_VERSION,
                            existingStores: [...db.objectStoreNames],
                        }, 'info');
                        if (!db.objectStoreNames.contains(OUTGOING_MESSAGE_STORE_NAME)) {
                            db.createObjectStore(OUTGOING_MESSAGE_STORE_NAME, { keyPath: 'messageKey' });
                        }
                        if (!db.objectStoreNames.contains(INCOMING_SETTINGS_STORE_NAME)) {
                            db.createObjectStore(INCOMING_SETTINGS_STORE_NAME, { keyPath: 'settingsKey' });
                        }
                        if (!db.objectStoreNames.contains(DETECTED_LANGUAGE_STORE_NAME)) {
                            db.createObjectStore(DETECTED_LANGUAGE_STORE_NAME, { keyPath: 'profileKey' });
                        }
                        if (!db.objectStoreNames.contains(OUTGOING_MESSAGE_META_STORE_NAME)) {
                            db.createObjectStore(OUTGOING_MESSAGE_META_STORE_NAME, { keyPath: 'messageKey' });
                        }
                        if (!db.objectStoreNames.contains(TRANSLATION_CACHE_STORE_NAME)) {
                            db.createObjectStore(TRANSLATION_CACHE_STORE_NAME, { keyPath: 'cacheKey' });
                        }
                    };

                    request.onsuccess = () => {
                        telemetry.capture('db.open.success', {
                            dbName: OUTGOING_MESSAGE_DB_NAME,
                            stores: [...request.result.objectStoreNames],
                        }, 'info');
                        resolve(request.result);
                    };
                    request.onerror = () => {
                        const error = request.error || new Error('Failed to open IndexedDB');
                        telemetry.capture('db.open.error', {
                            dbName: OUTGOING_MESSAGE_DB_NAME,
                            error,
                        }, 'error');
                        reject(error);
                    };
                }).catch(error => {
                    telemetry.capture('db.open.failed', {
                        dbName: OUTGOING_MESSAGE_DB_NAME,
                        error,
                    }, 'error');
                    log('IndexedDB unavailable for outgoing message persistence', error);
                    this.dbPromise = null;
                    return null;
                });
            }

            return this.dbPromise;
        }

        async putToStore(storeName, record) {
            const db = await this.open();
            if (!db || !record) return;
            telemetry.capture('db.put.start', {
                storeName,
                key: record.messageKey || record.settingsKey || record.profileKey || null,
                record,
            });

            await new Promise((resolve, reject) => {
                const transaction = db.transaction(storeName, 'readwrite');
                transaction.objectStore(storeName).put(record);
                transaction.oncomplete = () => {
                    telemetry.capture('db.put.success', {
                        storeName,
                        key: record.messageKey || record.settingsKey || record.profileKey || null,
                    });
                    resolve();
                };
                transaction.onerror = () => reject(transaction.error || new Error(`Failed to write to ${storeName}`));
                transaction.onabort = () => reject(transaction.error || new Error(`${storeName} transaction aborted`));
            }).catch(error => {
                telemetry.capture('db.put.failed', {
                    storeName,
                    key: record.messageKey || record.settingsKey || record.profileKey || null,
                    record,
                    error,
                }, 'error');
                log(`Failed to write record to ${storeName}`, error);
            });
        }

        async getFromStore(storeName, key) {
            const db = await this.open();
            if (!db || !key) return null;
            telemetry.capture('db.get.start', {
                storeName,
                key,
            });

            return new Promise((resolve, reject) => {
                const transaction = db.transaction(storeName, 'readonly');
                const request = transaction.objectStore(storeName).get(key);
                request.onsuccess = () => {
                    telemetry.capture('db.get.success', {
                        storeName,
                        key,
                        found: Boolean(request.result),
                        record: request.result || null,
                    });
                    resolve(request.result || null);
                };
                request.onerror = () => reject(request.error || new Error(`Failed to read from ${storeName}`));
            }).catch(error => {
                telemetry.capture('db.get.failed', {
                    storeName,
                    key,
                    error,
                }, 'error');
                log(`Failed to read record from ${storeName}`, error);
                return null;
            });
        }

        async getAllFromStore(storeName) {
            const db = await this.open();
            if (!db) return [];
            telemetry.capture('db.getAll.start', {
                storeName,
            });

            return new Promise((resolve, reject) => {
                const transaction = db.transaction(storeName, 'readonly');
                const request = transaction.objectStore(storeName).getAll();
                request.onsuccess = () => {
                    telemetry.capture('db.getAll.success', {
                        storeName,
                        count: request.result?.length || 0,
                        records: request.result || [],
                    });
                    resolve(request.result || []);
                };
                request.onerror = () => reject(request.error || new Error(`Failed to read all records from ${storeName}`));
            }).catch(error => {
                telemetry.capture('db.getAll.failed', {
                    storeName,
                    error,
                }, 'error');
                log(`Failed to read all records from ${storeName}`, error);
                return [];
            });
        }

        async deleteFromStore(storeName, key) {
            const db = await this.open();
            if (!db || !key) return;
            telemetry.capture('db.delete.start', {
                storeName,
                key,
            });

            await new Promise((resolve, reject) => {
                const transaction = db.transaction(storeName, 'readwrite');
                transaction.objectStore(storeName).delete(key);
                transaction.oncomplete = () => {
                    telemetry.capture('db.delete.success', {
                        storeName,
                        key,
                    });
                    resolve();
                };
                transaction.onerror = () => reject(transaction.error || new Error(`Failed to delete from ${storeName}`));
                transaction.onabort = () => reject(transaction.error || new Error(`${storeName} delete transaction aborted`));
            }).catch(error => {
                telemetry.capture('db.delete.failed', {
                    storeName,
                    key,
                    error,
                }, 'error');
                log(`Failed to delete record from ${storeName}`, error);
            });
        }

        async put(record) {
            if (!record?.messageKey) return;
            await this.putToStore(OUTGOING_MESSAGE_STORE_NAME, record);
        }

        async get(messageKey) {
            if (!messageKey) return null;
            await this.migrateLegacyOutgoingRecords();
            return this.getFromStore(OUTGOING_MESSAGE_STORE_NAME, messageKey);
        }

        async delete(messageKey) {
            if (!messageKey) return;
            await this.deleteFromStore(OUTGOING_MESSAGE_STORE_NAME, messageKey);
        }

        async purgeExpired(now = Date.now()) {
            await this.migrateLegacyOutgoingRecords();
            const records = await this.getAllFromStore(OUTGOING_MESSAGE_STORE_NAME);
            telemetry.capture('db.purgeExpired.start', {
                now,
                candidateCount: records.length,
            });
            for (const record of records) {
                if (Number(record?.expiresAt || 0) > 0 && Number(record.expiresAt) <= now) {
                    await this.deleteFromStore(OUTGOING_MESSAGE_STORE_NAME, record.messageKey);
                }
            }

            const cachedTranslations = await this.getAllFromStore(TRANSLATION_CACHE_STORE_NAME);
            for (const record of cachedTranslations) {
                if (Number(record?.expiresAt || 0) > 0 && Number(record.expiresAt) <= now) {
                    await this.deleteFromStore(TRANSLATION_CACHE_STORE_NAME, record.cacheKey);
                }
            }
        }

        async putIncomingSettings(record) {
            if (!record?.settingsKey) return;
            await this.putToStore(INCOMING_SETTINGS_STORE_NAME, record);
        }

        async getIncomingSettings(settingsKey) {
            return this.getFromStore(INCOMING_SETTINGS_STORE_NAME, settingsKey);
        }

        async putDetectedLanguage(record) {
            if (!record?.profileKey) return;
            await this.putToStore(DETECTED_LANGUAGE_STORE_NAME, record);
        }

        async getDetectedLanguage(profileKey) {
            return this.getFromStore(DETECTED_LANGUAGE_STORE_NAME, profileKey);
        }

        async putOutgoingMessageMeta(record) {
            if (!record?.messageKey) return;
            await this.putToStore(OUTGOING_MESSAGE_META_STORE_NAME, {
                ...record,
                expiresAt: Number.MAX_SAFE_INTEGER,
            });
        }

        async getOutgoingMessageMeta(messageKey) {
            if (!messageKey) return null;
            await this.migrateLegacyOutgoingRecords();
            return this.getFromStore(OUTGOING_MESSAGE_META_STORE_NAME, messageKey);
        }

        async getAllOutgoingMessages() {
            await this.migrateLegacyOutgoingRecords();
            return this.getAllFromStore(OUTGOING_MESSAGE_STORE_NAME);
        }

        async putTranslationCache(record) {
            if (!record?.cacheKey) return;
            await this.putToStore(TRANSLATION_CACHE_STORE_NAME, record);
        }

        async getTranslationCache(cacheKey) {
            if (!cacheKey) return null;
            const record = await this.getFromStore(TRANSLATION_CACHE_STORE_NAME, cacheKey);
            if (!record) return null;
            if (Number(record.expiresAt || 0) <= Date.now()) {
                await this.deleteFromStore(TRANSLATION_CACHE_STORE_NAME, cacheKey);
                return null;
            }
            return record;
        }

        buildOutgoingStorageKey(messageKey) {
            return `${GM_SECURE_OUTGOING_RECORD_PREFIX}${encodeURIComponent(messageKey)}`;
        }

        buildOutgoingMetaStorageKey(messageKey) {
            return `${GM_SECURE_OUTGOING_META_PREFIX}${encodeURIComponent(messageKey)}`;
        }

        getKeyring() {
            const stored = gmGetJson(GM_SECURE_KEYRING_STORAGE_KEY, []);
            return Array.isArray(stored) ? stored : [];
        }

        setKeyring(keyring) {
            gmSetJson(GM_SECURE_KEYRING_STORAGE_KEY, keyring);
        }

        async getOrCreateActiveKeyRecord(now = Date.now()) {
            const keyring = this.getKeyring().filter(keyRecord => Number(keyRecord.decryptUntil || 0) > now);
            let active = keyring.find(keyRecord => Number(keyRecord.rotateAt || 0) > now);
            if (!active) {
                const cryptoKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
                const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', cryptoKey));
                active = {
                    id: `qts-${now}`,
                    createdAt: now,
                    rotateAt: now + OUTGOING_KEY_ROTATION_MS,
                    decryptUntil: now + OUTGOING_KEY_DECRYPT_RETENTION_MS,
                    rawKey: bytesToBase64(rawKey),
                };
                keyring.push(active);
                this.cryptoKeyCache.set(active.id, cryptoKey);
                this.setKeyring(keyring);
            }
            return active;
        }

        async getCryptoKey(keyRecord) {
            if (!keyRecord?.id || !keyRecord?.rawKey) return null;
            const cached = this.cryptoKeyCache.get(keyRecord.id);
            if (cached) return cached;
            const cryptoKey = await crypto.subtle.importKey('raw', base64ToBytes(keyRecord.rawKey), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
            this.cryptoKeyCache.set(keyRecord.id, cryptoKey);
            return cryptoKey;
        }

        async encryptOutgoingPayload(record) {
            if (!window.crypto?.subtle) return null;
            const keyRecord = await this.getOrCreateActiveKeyRecord();
            const cryptoKey = await this.getCryptoKey(keyRecord);
            if (!cryptoKey) return null;

            const iv = crypto.getRandomValues(new Uint8Array(12));
            const payload = new TextEncoder().encode(JSON.stringify(record));
            const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, payload);
            return {
                version: 1,
                keyId: keyRecord.id,
                iv: bytesToBase64(iv),
                cipherText: bytesToBase64(new Uint8Array(cipherBuffer)),
                expiresAt: Number(record.expiresAt || 0),
            };
        }

        async decryptOutgoingPayload(encryptedRecord) {
            if (!encryptedRecord?.keyId || !encryptedRecord?.iv || !encryptedRecord?.cipherText) return null;
            const keyRecord = this.getKeyring().find(item => item.id === encryptedRecord.keyId);
            if (!keyRecord) return null;
            const cryptoKey = await this.getCryptoKey(keyRecord);
            if (!cryptoKey) return null;

            try {
                const plainBuffer = await crypto.subtle.decrypt(
                    { name: 'AES-GCM', iv: base64ToBytes(encryptedRecord.iv) },
                    cryptoKey,
                    base64ToBytes(encryptedRecord.cipherText),
                );
                return safeJsonParse(new TextDecoder().decode(plainBuffer), null);
            } catch (error) {
                log('Failed to decrypt outgoing payload', error);
                return null;
            }
        }

        async migrateLegacyOutgoingRecords() {
            const legacyRecordKeys = gmListKeys().filter(key => key.startsWith(GM_SECURE_OUTGOING_RECORD_PREFIX));
            telemetry.capture('db.migrateLegacy.start', {
                legacyRecordCount: legacyRecordKeys.length,
            }, legacyRecordKeys.length ? 'warn' : 'debug');
            for (const key of legacyRecordKeys) {
                const encrypted = gmGetJson(key, null);
                const record = await this.decryptOutgoingPayload(encrypted);
                if (record?.messageKey) {
                    await this.putToStore(OUTGOING_MESSAGE_STORE_NAME, record);
                }
                gmDeleteKey(key);
            }

            const legacyMetaKeys = gmListKeys().filter(key => key.startsWith(GM_SECURE_OUTGOING_META_PREFIX));
            for (const key of legacyMetaKeys) {
                const encrypted = gmGetJson(key, null);
                const record = await this.decryptOutgoingPayload(encrypted);
                if (record?.messageKey) {
                    await this.putToStore(OUTGOING_MESSAGE_META_STORE_NAME, record);
                }
                gmDeleteKey(key);
            }

            gmDeleteKey(GM_SECURE_KEYRING_STORAGE_KEY);
            this.cryptoKeyCache.clear();
            telemetry.capture('db.migrateLegacy.completed', {
                migratedRecordCount: legacyRecordKeys.length,
                migratedMetaCount: legacyMetaKeys.length,
            }, 'info');
        }
    }

    async function withRetries(operation, attempts = CONFIG.apiRetryAttempts, delayMs = CONFIG.apiRetryDelayMs) {
        let lastError = null;

        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            try {
                telemetry.capture('retry.attempt', {
                    attempt,
                    attempts,
                    delayMs,
                });
                return await operation(attempt);
            } catch (error) {
                lastError = error;
                telemetry.capture('retry.failedAttempt', {
                    attempt,
                    attempts,
                    delayMs,
                    error,
                }, attempt >= attempts ? 'error' : 'warn');
                if (attempt >= attempts) break;
                await sleep(delayMs * attempt);
            }
        }

        throw lastError || new Error('Unknown retry failure');
    }

    function getMessageContentNode(textNode) {
        let contentNode = textNode.querySelector('[data-qts-message-content="1"]');
        if (contentNode) return contentNode;

        const directTextNodes = [...textNode.childNodes]
            .filter(node => node.nodeType === Node.TEXT_NODE && normalizeWhitespace(node.textContent || '').length > 0);
        if (directTextNodes.length) {
            contentNode = document.createElement('span');
            contentNode.dataset.qtsMessageContent = '1';
            textNode.insertBefore(contentNode, directTextNodes[0]);
            directTextNodes.forEach(node => {
                contentNode.appendChild(node);
            });
            return contentNode;
        }

        contentNode = [...textNode.children].find(child =>
            ['SPAN', 'DIV', 'P'].includes(child.tagName)
            && child.dataset.qtsToggle !== '1'
            && child.dataset.qtsStatus !== '1'
            && child.dataset.qtsBacklogProgress !== '1'
            && !child.classList.contains('message-indicators')
        );
        if (contentNode) {
            contentNode.dataset.qtsMessageContent = '1';
            return contentNode;
        }

        contentNode = document.createElement('span');
        contentNode.dataset.qtsMessageContent = '1';
        contentNode.textContent = normalizeWhitespace(textNode.textContent);
        textNode.textContent = '';
        textNode.appendChild(contentNode);
        return contentNode;
    }

    function ensureToggleButton(textNode) {
        let container = textNode.querySelector('.translation-toggle-container[data-qts-toggle="1"]');
        if (container) return container;

        container = document.createElement('span');
        container.className = 'translation-toggle-container';
        container.dataset.testid = 'translation-toggle-container';
        container.dataset.qtsToggle = '1';
        container.dataset.translateToggleKey = `qts-toggle-${Math.random().toString(36).slice(2, 10)}`;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ebCySkD4Gv8pQdxw8kqa';
        button.setAttribute('aria-pressed', 'false');
        button.setAttribute('aria-label', 'See translation');
        button.dataset.testid = 'translate-text-in-chat-button';
        button.innerHTML = TRANSLATION_TOGGLE_SVG;

        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            const showTranslated = button.getAttribute('aria-pressed') !== 'true';
            setMessageTranslationState(textNode, showTranslated);
        });

        container.appendChild(button);
        textNode.appendChild(container);
        return container;
    }

    function getMessageStatusNode(textNode) {
        let statusNode = textNode.querySelector('[data-qts-status="1"]');
        if (statusNode) return statusNode;

        statusNode = document.createElement('span');
        statusNode.dataset.qtsStatus = '1';
        textNode.appendChild(statusNode);
        return statusNode;
    }

    function clearMessageStatus(textNode) {
        const statusNode = textNode.querySelector('[data-qts-status="1"]');
        if (statusNode) {
            statusNode.remove();
        }
    }

    function isTextEntryElement(node) {
        return node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement;
    }

    function setNativeTextEntryValue(inputNode, text) {
        if (!isTextEntryElement(inputNode)) return;

        const prototype = inputNode instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

        if (descriptor?.set) {
            descriptor.set.call(inputNode, text);
        } else {
            inputNode.value = text;
        }
    }

    function getComposerText(inputNode) {
        if (isTextEntryElement(inputNode)) {
            return normalizeWhitespace(inputNode.value || '');
        }
        return normalizeWhitespace(inputNode?.innerText || inputNode?.textContent || '');
    }

    function setComposerText(inputNode, text) {
        if (!inputNode) return;

        inputNode.focus();
        if (isTextEntryElement(inputNode)) {
            inputNode.dispatchEvent(new InputEvent('beforeinput', {
                bubbles: true,
                cancelable: true,
                inputType: 'insertReplacementText',
                data: text,
            }));
            setNativeTextEntryValue(inputNode, text);
            inputNode.setSelectionRange(text.length, text.length);
        } else {
            inputNode.textContent = text;

            const selection = window.getSelection();
            if (selection) {
                const range = document.createRange();
                range.selectNodeContents(inputNode);
                range.collapse(false);
                selection.removeAllRanges();
                selection.addRange(range);
            }
        }

        inputNode.dispatchEvent(new Event('input', {
            bubbles: true,
        }));
        inputNode.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: text,
        }));
        inputNode.dispatchEvent(new KeyboardEvent('keyup', {
            bubbles: true,
            key: 'Unidentified',
        }));
        inputNode.dispatchEvent(new Event('change', { bubbles: true }));
    }

    async function waitForComposerText(inputNode, expectedText, timeoutMs = 500) {
        const startedAt = Date.now();
        const expected = normalizeWhitespace(expectedText || '');

        while (Date.now() - startedAt < timeoutMs) {
            if (getComposerText(inputNode) === expected) {
                return true;
            }
            await sleep(25);
        }

        return getComposerText(inputNode) === expected;
    }

    function getComposerStatusNode(inputNode) {
        const container = inputNode?.closest(
            '[data-testid="user-list-tab-chat-input-container"], .inputDiv, .chat-controls-content, .chat-input, [class*="ChatInput__wrapper"]'
        );
        if (!container) return null;

        let statusNode = container.querySelector('[data-qts-composer-status="1"]');
        if (statusNode) return statusNode;

        statusNode = document.createElement('div');
        statusNode.dataset.qtsComposerStatus = '1';
        container.appendChild(statusNode);
        return statusNode;
    }

    function clearComposerStatus(inputNode) {
        const container = inputNode?.closest(
            '[data-testid="user-list-tab-chat-input-container"], .inputDiv, .chat-controls-content, .chat-input, [class*="ChatInput__wrapper"]'
        );
        const statusNode = container?.querySelector('[data-qts-composer-status="1"]');
        if (statusNode) {
            statusNode.remove();
        }
    }

    function renderComposerError(inputNode, error) {
        const statusNode = getComposerStatusNode(inputNode);
        if (!statusNode) return;

        statusNode.dataset.qtsComposerStatusType = 'error';
        statusNode.textContent = 'translation error';
        statusNode.title = error?.message || 'Translation failed before send';
    }

    function renderComposerInfo(inputNode, text) {
        const statusNode = getComposerStatusNode(inputNode);
        if (!statusNode) return;

        delete statusNode.dataset.qtsComposerStatusType;
        statusNode.textContent = text;
        statusNode.title = text;
    }

    function setComposerBusyState(inputNode, sendButton, isBusy) {
        if (inputNode) {
            if (isTextEntryElement(inputNode)) {
                if (isBusy) {
                    inputNode.dataset.qtsComposerBusy = '1';
                    inputNode.setAttribute('aria-busy', 'true');
                } else {
                    delete inputNode.dataset.qtsComposerBusy;
                    inputNode.removeAttribute('aria-busy');
                }
            } else if (isBusy) {
                inputNode.dataset.qtsComposerBusy = '1';
                inputNode.dataset.qtsPrevContenteditable = inputNode.getAttribute('contenteditable') ?? '';
                inputNode.setAttribute('contenteditable', 'false');
                inputNode.setAttribute('aria-disabled', 'true');
            } else {
                delete inputNode.dataset.qtsComposerBusy;
                const previous = inputNode.dataset.qtsPrevContenteditable;
                if (previous === '') {
                    inputNode.removeAttribute('contenteditable');
                } else if (typeof previous === 'string') {
                    inputNode.setAttribute('contenteditable', previous);
                }
                delete inputNode.dataset.qtsPrevContenteditable;
                inputNode.removeAttribute('aria-disabled');
            }
        }

        if (sendButton) {
            if (isBusy) {
                sendButton.dataset.qtsSendBusy = '1';
                sendButton.setAttribute('aria-disabled', 'true');
            } else {
                delete sendButton.dataset.qtsSendBusy;
                sendButton.removeAttribute('aria-disabled');
            }
        }
    }

    async function waitForComposerSendSettlement(inputNode, timeoutMs = CONFIG.outgoingLockMaxMs) {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            if (!inputNode?.isConnected) return;
            if (!getComposerText(inputNode)) return;
            await sleep(120);
        }
    }

    function getBacklogProgressNode(messageList) {
        let node = messageList.querySelector('[data-qts-backlog-progress="1"]');
        if (node) return node;

        node = document.createElement('div');
        node.dataset.qtsBacklogProgress = '1';
        node.dataset.qtsBacklogCreatedAt = String(Date.now());
        node.innerHTML = `
            <span data-qts-backlog-label="1">translating</span>
            <span data-qts-backlog-dots="1" aria-hidden="true">
                <span data-qts-backlog-dot="1"></span>
                <span data-qts-backlog-dot="1"></span>
                <span data-qts-backlog-dot="1"></span>
            </span>
        `;
        const lastMessage = [...messageList.querySelectorAll('[data-testid="chat-message"][data-ts]')].at(-1);
        if (lastMessage?.parentNode === messageList) {
            lastMessage.insertAdjacentElement('afterend', node);
        } else {
            messageList.appendChild(node);
        }
        return node;
    }

    function revealBacklogProgress(messageList) {
        const node = getBacklogProgressNode(messageList);
        const lastMessage = [...messageList.querySelectorAll('[data-testid="chat-message"][data-ts]')].at(-1);
        if (lastMessage?.nextElementSibling !== node) {
            if (lastMessage?.parentNode === messageList) {
                lastMessage.insertAdjacentElement('afterend', node);
            } else if (node.parentNode !== messageList) {
                messageList.appendChild(node);
            }
        }
        const scroller = messageList?.parentElement;
        if (scroller && 'scrollTop' in scroller) {
            scroller.scrollTop = scroller.scrollHeight;
        }
    }

    /**
     * Muestra indicadores de carga (loading spinners) en los mensajes mientras se espera a la API.
     */
    function updateBacklogProgress(messageList, current, total) {
        getBacklogProgressNode(messageList);
        revealBacklogProgress(messageList);
    }

    function removeBacklogProgress(messageList) {
        const node = messageList?.querySelector('[data-qts-backlog-progress="1"]');
        if (node) {
            node.remove();
        }
    }

    async function removeBacklogProgressWhenReady(messageList) {
        const node = messageList?.querySelector('[data-qts-backlog-progress="1"]');
        if (!node) return;

        const createdAt = Number(node.dataset.qtsBacklogCreatedAt || Date.now());
        const elapsed = Date.now() - createdAt;
        if (elapsed < BACKLOG_PROGRESS_MIN_VISIBLE_MS) {
            await sleep(BACKLOG_PROGRESS_MIN_VISIBLE_MS - elapsed);
        }

        removeBacklogProgress(messageList);
    }

    function setMessageTranslationState(textNode, showTranslated) {
        const contentNode = getMessageContentNode(textNode);
        const toggleButton = textNode.querySelector('.translation-toggle-container[data-qts-toggle="1"] button');
        const originalText = textNode.dataset.qtsOriginalText || contentNode.textContent || '';
        const translatedText = textNode.dataset.qtsTranslatedText || originalText;

        contentNode.textContent = showTranslated ? translatedText : originalText;
        textNode.dataset.qtsShowing = showTranslated ? 'translated' : 'original';

        if (!toggleButton) return;

        toggleButton.setAttribute('aria-pressed', showTranslated ? 'true' : 'false');
        toggleButton.setAttribute('aria-label', showTranslated ? 'See original' : 'See translation');
        toggleButton.classList.toggle('LbQPloYMQSit0_FMAd1n', showTranslated);
    }

    function createPendingTranslationNode(message) {
        if (!message.textNode) return null;
        message.textNode.dataset.qtsPending = '1';
        clearMessageStatus(message.textNode);
        return message.textNode;
    }

    function renderTranslation(message, translatedText, detectedLanguage) {
        if (!message.textNode) return;

        const textNode = message.textNode;
        const contentNode = getMessageContentNode(textNode);

        textNode.dataset.qtsOriginalText = message.text;
        textNode.dataset.qtsTranslatedText = translatedText;
        if (detectedLanguage) {
            textNode.dataset.qtsDetectedLanguage = detectedLanguage;
        }

        contentNode.classList.add(TRANSLATION_BLOCK_CLASS);
        ensureToggleButton(textNode);
        clearMessageStatus(textNode);
        setMessageTranslationState(textNode, isTranslationEnabled(message.stateRef || null));
        delete textNode.dataset.qtsPending;
        delete textNode.dataset.qtsError;
    }

    function markSkipped(message) {
        if (!message.textNode) return;
        const textNode = message.textNode;
        const contentNode = getMessageContentNode(textNode);
        contentNode.classList.add(TRANSLATION_BLOCK_CLASS);
        delete textNode.dataset.qtsPending;
        delete textNode.dataset.qtsError;
        clearMessageStatus(textNode);
    }

    function renderTranslationError(message, error) {
        if (!message.textNode) return;

        const textNode = message.textNode;
        const statusNode = getMessageStatusNode(textNode);
        delete textNode.dataset.qtsPending;
        textNode.dataset.qtsError = '1';
        statusNode.dataset.qtsStatusType = 'error';
        statusNode.textContent = 'translation error';
        statusNode.title = error?.message || 'Translation failed after 3 attempts';
    }

    function resetRenderedTranslation(textNode) {
        if (!textNode) return;

        const originalText = textNode.dataset.qtsOriginalText || normalizeWhitespace(textNode.textContent || '');
        const contentNode = getMessageContentNode(textNode);
        contentNode.textContent = originalText;
        contentNode.classList.remove(TRANSLATION_BLOCK_CLASS);
        textNode.dataset.qtsOriginalText = originalText;
        delete textNode.dataset.qtsTranslatedText;
        delete textNode.dataset.qtsDetectedLanguage;
        delete textNode.dataset.qtsShowing;
        delete textNode.dataset.qtsPending;
        delete textNode.dataset.qtsError;
        textNode.querySelector('.translation-toggle-container[data-qts-toggle="1"]')?.remove();
        clearMessageStatus(textNode);
    }

    function gmRequest(options) {
        return new Promise((resolve, reject) => {
            const requestStartedAt = Date.now();
            const requestId = `${requestStartedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
            if (!options.skipTelemetry) {
                telemetry.capture('http.request.started', {
                    requestId,
                    method: options.method || 'GET',
                    url: options.url,
                    headers: options.headers,
                    data: options.data,
                    context: options.context || null,
                    timeout: options.timeout || 30000,
                });
            }
            GM_xmlhttpRequest({
                method: options.method || 'GET',
                url: options.url,
                headers: options.headers || {
                    Accept: '*/*',
                    'Accept-Language': 'en-US,en;q=0.9',
                },
                data: options.data,
                timeout: options.timeout || 30000,
                onload: (response) => {
                    if (response.status >= 200 && response.status < 300) {
                        if (!options.skipTelemetry) {
                            telemetry.capture('http.request.succeeded', {
                                requestId,
                                method: options.method || 'GET',
                                url: options.url,
                                status: response.status,
                                durationMs: Date.now() - requestStartedAt,
                                responseHeaders: response.responseHeaders,
                                responseText: response.responseText,
                                context: options.context || null,
                            });
                        }
                        resolve(response);
                    } else {
                        const error = new Error(`HTTP ${response.status}: ${response.responseText}`);
                        if (!options.skipTelemetry) {
                            telemetry.capture('http.request.failed', {
                                requestId,
                                method: options.method || 'GET',
                                url: options.url,
                                status: response.status,
                                durationMs: Date.now() - requestStartedAt,
                                responseText: response.responseText,
                                context: options.context || null,
                                error,
                            }, 'error');
                        }
                        reject(error);
                    }
                },
                onerror: error => {
                    if (!options.skipTelemetry) {
                        telemetry.capture('http.request.networkError', {
                            requestId,
                            method: options.method || 'GET',
                            url: options.url,
                            durationMs: Date.now() - requestStartedAt,
                            context: options.context || null,
                            error,
                        }, 'error');
                    }
                    reject(error);
                },
                ontimeout: () => {
                    const error = new Error('Request timed out');
                    if (!options.skipTelemetry) {
                        telemetry.capture('http.request.timeout', {
                            requestId,
                            method: options.method || 'GET',
                            url: options.url,
                            durationMs: Date.now() - requestStartedAt,
                            context: options.context || null,
                        }, 'error');
                    }
                    reject(error);
                },
            });
        });
    }

    /**
     * Traductor basado en los endpoints web de Google Translate.
     * Mantiene la misma interfaz que el proveedor anterior para que el resto del
     * controlador siga funcionando sin cambios, incluida la caché en IndexedDB.
     */
    class GoogleTranslator {
        constructor(store = null) {
            this.primaryTranslateUrl = 'https://translate.googleapis.com/translate_a/single';
            this.fallbackTranslateUrl = 'https://clients5.google.com/translate_a/t';
            this.store = store;
        }

        createHeaders(additionalHeaders = {}) {
            return {
                Accept: 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                ...additionalHeaders,
            };
        }

        mapLanguageCode(code) {
            const normalized = String(code || CONFIG.sourceLanguage || 'auto').trim().toLowerCase();
            if (!normalized) return 'auto';
            if (normalized === 'auto') return 'auto';
            if (normalized === 'iw') return 'he';
            return normalized;
        }

        normalizeDetectedLanguage(code) {
            const normalized = String(code || '').trim().toLowerCase();
            if (!normalized) return null;
            if (normalized === 'iw') return 'he';
            return normalized;
        }

        buildPrimaryTranslateUrl(text, sourceLanguage, targetLanguage) {
            const params = new URLSearchParams();
            params.set('client', 'gtx');
            params.set('ie', 'UTF-8');
            params.set('oe', 'UTF-8');
            params.set('dj', '1');
            params.append('dt', 't');
            params.set('sl', this.mapLanguageCode(sourceLanguage));
            params.set('tl', this.mapLanguageCode(targetLanguage));
            params.set('q', text);
            return `${this.primaryTranslateUrl}?${params.toString()}`;
        }

        buildFallbackTranslateUrl(text, sourceLanguage, targetLanguage) {
            const params = new URLSearchParams();
            params.set('client', 'dict-chrome-ex');
            params.set('dj', '1');
            params.set('sl', this.mapLanguageCode(sourceLanguage));
            params.set('tl', this.mapLanguageCode(targetLanguage));
            params.set('q', text);
            return `${this.fallbackTranslateUrl}?${params.toString()}`;
        }

        parsePrimaryResponse(responseText) {
            const parsed = JSON.parse(responseText);
            if (!parsed || !Array.isArray(parsed.sentences)) {
                throw new Error('Empty or invalid response from Google primary endpoint');
            }
            const translatedText = parsed.sentences
                .map(item => item?.trans || item?.text || '')
                .join('')
                .trim();
            if (!translatedText) {
                throw new Error('Google primary endpoint returned an empty translation');
            }
            return {
                translatedText,
                detectedLanguage: this.normalizeDetectedLanguage(
                    parsed.src
                    || parsed.source
                    || parsed.sourceLanguage
                    || parsed?.ld_result?.srclangs?.[0]
                ),
                rawResponse: parsed,
            };
        }

        parseFallbackResponse(responseText) {
            const parsed = JSON.parse(responseText);
            const translatedText = Array.isArray(parsed) && Array.isArray(parsed[0]) ? String(parsed[0][0] || '').trim() : '';
            if (!translatedText) {
                throw new Error('Empty or invalid response from Google fallback endpoint');
            }
            return {
                translatedText,
                detectedLanguage: this.normalizeDetectedLanguage(
                    Array.isArray(parsed) && Array.isArray(parsed[0]) ? parsed[0][1] : null
                ),
                rawResponse: parsed,
            };
        }

        async requestPrimaryTranslation(text, sourceLanguage, targetLanguage, attempt) {
            const response = await gmRequest({
                method: 'GET',
                url: this.buildPrimaryTranslateUrl(text, sourceLanguage, targetLanguage),
                headers: this.createHeaders(),
                context: {
                    area: 'translator-translateText',
                    provider: 'google-primary',
                    sourceLanguage,
                    targetLanguage,
                    attempt,
                    textLength: text?.length || 0,
                },
            });
            return this.parsePrimaryResponse(response.responseText);
        }

        async requestFallbackTranslation(text, sourceLanguage, targetLanguage, attempt, primaryError) {
            telemetry.capture('translator.translateText.endpointFallback', {
                sourceLanguage,
                targetLanguage,
                attempt,
                textLength: text?.length || 0,
                fallbackProvider: 'google-fallback',
                primaryError: primaryError ? {
                    name: primaryError.name,
                    message: primaryError.message,
                } : null,
            }, 'warn');

            const response = await gmRequest({
                method: 'GET',
                url: this.buildFallbackTranslateUrl(text, sourceLanguage, targetLanguage),
                headers: this.createHeaders(),
                context: {
                    area: 'translator-translateText',
                    provider: 'google-fallback',
                    sourceLanguage,
                    targetLanguage,
                    attempt,
                    textLength: text?.length || 0,
                },
            });
            return this.parseFallbackResponse(response.responseText);
        }

        async getCachedTranslation(text, sourceLanguage, targetLanguage) {
            if (!this.store) return null;
            const cacheKey = buildTranslationCacheKey(sourceLanguage, targetLanguage, text);
            if (!cacheKey) return null;

            const cached = await this.store.getTranslationCache(cacheKey);
            telemetry.capture('translator.cache.lookup', {
                cacheKey,
                sourceLanguage,
                targetLanguage,
                textLength: text?.length || 0,
                hit: Boolean(cached),
            }, cached ? 'info' : 'debug');
            return cached;
        }

        async putCachedTranslation(text, sourceLanguage, targetLanguage, translatedText, detectedLanguage, metadata = {}) {
            if (!this.store) return;
            const cacheKey = buildTranslationCacheKey(sourceLanguage, targetLanguage, text);
            const normalizedText = normalizeWhitespace(text || '');
            const normalizedTranslatedText = normalizeWhitespace(translatedText || '');
            if (!cacheKey || !normalizedText || !normalizedTranslatedText) return;

            await this.store.putTranslationCache({
                cacheKey,
                sourceLanguage: String(sourceLanguage || CONFIG.sourceLanguage || 'auto').toLowerCase(),
                targetLanguage: String(targetLanguage || CONFIG.targetLanguage || 'auto').toLowerCase(),
                sourceText: normalizedText,
                translatedText: normalizedTranslatedText,
                detectedLanguage: detectedLanguage || null,
                createdAt: Date.now(),
                expiresAt: Date.now() + TRANSLATION_CACHE_TTL_MS,
                metadata: {
                    ...metadata,
                },
            });

            telemetry.capture('translator.cache.write', {
                cacheKey,
                sourceLanguage,
                targetLanguage,
                textLength: normalizedText.length,
                translatedTextLength: normalizedTranslatedText.length,
                detectedLanguage,
                metadata,
            }, 'info');
        }

        async translateText(text, sourceLanguage = CONFIG.sourceLanguage, targetLanguage = CONFIG.targetLanguage, options = {}) {
            telemetry.capture('translator.translateText.start', {
                sourceLanguage,
                targetLanguage,
                text,
                textLength: text?.length || 0,
                skipCache: Boolean(options.skipCache),
            }, 'info');

            if (!options.skipCache) {
                const cached = await this.getCachedTranslation(text, sourceLanguage, targetLanguage);
                if (cached) {
                    telemetry.capture('translator.translateText.cacheHit', {
                        sourceLanguage,
                        targetLanguage,
                        text,
                        cacheKey: cached.cacheKey,
                        detectedLanguage: cached.detectedLanguage,
                    }, 'info');
                    return {
                        translatedText: cached.translatedText,
                        detectedLanguage: cached.detectedLanguage || null,
                    };
                }
            }

            return withRetries(async (attempt) => {
                let translated;
                try {
                    translated = await this.requestPrimaryTranslation(text, sourceLanguage, targetLanguage, attempt);
                } catch (primaryError) {
                    translated = await this.requestFallbackTranslation(
                        text,
                        sourceLanguage,
                        targetLanguage,
                        attempt,
                        primaryError
                    );
                }

                telemetry.capture('translator.translateText.success', {
                    sourceLanguage,
                    targetLanguage,
                    attempt,
                    requestText: text,
                    translatedText: translated.translatedText,
                    detectedLanguage: translated.detectedLanguage,
                    rawResponse: translated.rawResponse,
                }, 'info');

                await this.putCachedTranslation(
                    text,
                    sourceLanguage,
                    targetLanguage,
                    translated.translatedText,
                    translated.detectedLanguage,
                    { mode: options.mode || 'single', attempt }
                );

                return {
                    translatedText: translated.translatedText,
                    detectedLanguage: translated.detectedLanguage,
                };
            }, CONFIG.apiRetryAttempts, CONFIG.apiRetryDelayMs);
        }

        async translateBatch(messages, limits, targetLanguage = CONFIG.targetLanguage) {
            telemetry.capture('translator.translateBatch.start', {
                targetLanguage,
                messageCount: messages.length,
                limits,
                messages: messages.map(message => ({
                    id: message.id,
                    authorName: message.authorName,
                    timestamp: message.timestamp,
                    direction: message.direction,
                    text: message.text,
                })),
            }, 'info');
            const sourceLanguage = CONFIG.sourceLanguage;
            const cachedResults = [];
            const uncachedMessages = [];

            for (const message of messages) {
                const cached = await this.getCachedTranslation(message.text, sourceLanguage, targetLanguage);
                if (cached) {
                    cachedResults.push({
                        ...message,
                        translatedText: cached.translatedText,
                        detectedLanguage: cached.detectedLanguage || null,
                    });
                } else {
                    uncachedMessages.push(message);
                }
            }

            telemetry.capture('translator.translateBatch.cacheSummary', {
                targetLanguage,
                messageCount: messages.length,
                cachedCount: cachedResults.length,
                uncachedCount: uncachedMessages.length,
                cachedMessageIds: cachedResults.map(message => message.id),
            }, cachedResults.length ? 'info' : 'debug');

            if (!uncachedMessages.length) {
                return messages
                    .map(message => cachedResults.find(item => item.id === message.id))
                    .filter(Boolean);
            }

            const batches = [];
            let current = [];
            let currentChars = 0;

            for (const message of uncachedMessages) {
                const msgChars = message.text.length;
                const nextWouldOverflow =
                    current.length >= limits.maxMessages ||
                    (current.length > 0 && currentChars + msgChars > limits.maxChars);

                if (nextWouldOverflow) {
                    batches.push(current);
                    current = [];
                    currentChars = 0;
                }

                current.push(message);
                currentChars += msgChars;
            }

            if (current.length) batches.push(current);

            const results = [];
            for (const batch of batches) {
                telemetry.capture('translator.translateBatch.subBatch', {
                    targetLanguage,
                    batchSize: batch.length,
                    batchChars: batch.reduce((sum, message) => sum + message.text.length, 0),
                    messageIds: batch.map(message => message.id),
                });
                const translated = await this.translateMarkedBatch(batch, targetLanguage);
                results.push(...translated);
            }

            telemetry.capture('translator.translateBatch.success', {
                targetLanguage,
                resultCount: results.length,
                results: results.map(item => ({
                    id: item.id,
                    translatedText: item.translatedText,
                    detectedLanguage: item.detectedLanguage,
                })),
            }, 'info');
            const resultById = new Map([
                ...cachedResults.map(item => [item.id, item]),
                ...results.map(item => [item.id, item]),
            ]);

            return messages
                .map(message => resultById.get(message.id))
                .filter(Boolean);
        }

        async translateMarkedBatch(batch, targetLanguage = CONFIG.targetLanguage) {
            const joined = batch
                .map((message, index) => `${markerFor(index)}\n${message.text}`)
                .join('\n') + `\n${END_MARKER}`;

            telemetry.capture('translator.translateMarkedBatch.start', {
                targetLanguage,
                batchSize: batch.length,
                joinedText: joined,
                messageIds: batch.map(message => message.id),
            });
            const translated = await this.translateText(joined, CONFIG.sourceLanguage, targetLanguage, {
                skipCache: true,
                mode: 'marked-batch-joined',
            });
            const split = splitTranslatedBatch(translated.translatedText, batch.length);

            if (!split) {
                telemetry.capture('translator.translateMarkedBatch.markerFallback', {
                    targetLanguage,
                    batchSize: batch.length,
                    translatedText: translated.translatedText,
                    detectedLanguage: translated.detectedLanguage,
                }, 'warn');
                log('Batch markers were not preserved, falling back to per-message translation');
                const fallbackResults = [];
                for (const message of batch) {
                    const single = await this.translateText(message.text, CONFIG.sourceLanguage, targetLanguage);
                    fallbackResults.push({
                        ...message,
                        translatedText: single.translatedText,
                        detectedLanguage: single.detectedLanguage,
                    });
                }
                telemetry.capture('translator.translateMarkedBatch.fallbackSuccess', {
                    targetLanguage,
                    results: fallbackResults.map(item => ({
                        id: item.id,
                        translatedText: item.translatedText,
                        detectedLanguage: item.detectedLanguage,
                    })),
                }, 'info');
                return fallbackResults;
            }

            telemetry.capture('translator.translateMarkedBatch.success', {
                targetLanguage,
                split,
                detectedLanguage: translated.detectedLanguage,
            });
            const results = batch.map((message, index) => ({
                ...message,
                translatedText: split[index],
                detectedLanguage: translated.detectedLanguage,
            }));

            await Promise.all(results.map(item => this.putCachedTranslation(
                item.text,
                CONFIG.sourceLanguage,
                targetLanguage,
                item.translatedText,
                item.detectedLanguage,
                { mode: 'marked-batch-item', messageId: item.id }
            )));

            return results;
        }
    }

    /**
     * Adaptador Base para sitios.
     * Define la interfaz estándar que cada sitio (Chaturbate, Stripchat, etc.) debe implementar
     * para extraer elementos del DOM (chats, botones, inputs) de forma estandarizada.
     */
    class BaseSiteAdapter {
        constructor(siteId) {
            this.siteId = siteId;
        }

        emitTelemetry(event, payload = {}, level = 'debug') {
            telemetry.capture(`adapter.${event}`, {
                siteId: this.siteId,
                ...payload,
            }, level);
        }

        captureDomSnapshot(signature, node, options = {}) {
            return captureDomSnapshot(`${this.siteId}:${signature}`, node, options);
        }

        isSupported() {
            return false;
        }

        getConversationRoot() {
            return null;
        }

        getMessageElements() {
            return [];
        }

        parseMessageElement(_element) {
            return null;
        }

        getConversationIdentity() {
            return 'unknown';
        }

        getComposerInput() {
            return null;
        }

        getSendButton() {
            return null;
        }

        getMediaDock() {
            return null;
        }

        getControlBar() {
            return null;
        }

        getOutgoingLanguageHost() {
            return null;
        }

        supportsIncomingTranslation() {
            return true;
        }

        supportsIncomingTranslationUi() {
            return this.supportsIncomingTranslation();
        }
    }

    /**
     * Adaptador específico para Chaturbate.
     * Implementa la lógica para encontrar y manipular el DOM de los mensajes privados (PMs)
     * dentro de la estructura propia de Chaturbate.
     */
    class ChaturbatePmAdapter extends BaseSiteAdapter {
        constructor() {
            super('chaturbate-pm');
        }

        isSupported() {
            return /chaturbate\.com$/i.test(location.hostname);
        }

        getSelfUsername() {
            const match = location.pathname.match(/^\/b\/([^/]+)\//i);
            return match ? match[1].toLowerCase() : null;
        }

        isVisiblePmContainer(container) {
            if (!(container instanceof HTMLElement)) return false;

            const style = window.getComputedStyle(container);
            const rect = container.getBoundingClientRect();
            if (style.display === 'none' || style.visibility === 'hidden') {
                return false;
            }

            return rect.width > 0 && rect.height > 0;
        }

        findOpenPmContainer() {
            const candidates = [
                ...document.querySelectorAll('#ChatTabContents.TheatermodeChatDivPm, .ChatTabContents.TheatermodeChatDivPm, .TheatermodeChatDivPm')
            ].filter(candidate => this.isPrivateMessageContainer(candidate));
            const selected = candidates.find(candidate => this.isVisiblePmContainer(candidate))
                || candidates[0]
                || null;
            this.emitTelemetry('findOpenPmContainer', {
                method: 'findOpenPmContainer',
                candidateCount: candidates.length,
                found: Boolean(selected),
                selected,
                domSnapshot: selected
                    ? null
                    : this.captureDomSnapshot('find-open-pm-container-missing', document.body, {
                        includeParent: false,
                        extra: {
                            candidateSelectors: [
                                '#ChatTabContents.TheatermodeChatDivPm',
                                '.ChatTabContents.TheatermodeChatDivPm',
                                '.TheatermodeChatDivPm',
                            ],
                        },
                    }),
            }, selected ? 'debug' : 'warn');
            return selected;
        }

        resolveMessageList(container) {
            if (!container) return null;

            const preferredSelectors = [
                '.msg-list-fvm.message-list',
                '.message-list',
                '[class*="message-list"]',
                '[data-testid="chat-messages"]',
                '[data-testid="message-list"]',
                '[data-testid="conversation-list"]',
            ];

            for (const selector of preferredSelectors) {
                const candidates = [...container.querySelectorAll(selector)];
                const match = candidates.find(candidate =>
                    candidate.querySelector('[data-testid="chat-message"], [data-ts], [data-nick]')
                );
                if (match) {
                    this.emitTelemetry('selectorMatched', {
                        method: 'resolveMessageList',
                        selector,
                        candidateCount: candidates.length,
                        match,
                    });
                    return match;
                }
            }

            const fallback = [...container.querySelectorAll('div')]
                .find(candidate =>
                    candidate.querySelector('[data-testid="chat-message"], [data-ts], [data-nick]') &&
                    normalizeWhitespace(candidate.textContent || '').length > 0
                ) || null;
            this.emitTelemetry('selectorMatched', {
                method: 'resolveMessageList',
                selector: '<fallback-div-scan>',
                found: Boolean(fallback),
                match: fallback,
                domSnapshot: fallback
                    ? null
                    : this.captureDomSnapshot('resolve-message-list-missing', container, {
                        includeParent: false,
                        extra: { preferredSelectors },
                    }),
            }, fallback ? 'debug' : 'warn');
            return fallback;
        }

        resolveMessageTextNode(element) {
            if (!element) return null;

            const preferred = element.querySelector(
                '[data-testid="chat-message-text"], [data-testid="message-text"], [class*="messageText"], [class*="message-text"]'
            );
            if (preferred) {
                this.emitTelemetry('selectorMatched', {
                    method: 'resolveMessageTextNode',
                    selector: '[data-testid="chat-message-text"], [data-testid="message-text"], [class*="messageText"], [class*="message-text"]',
                    found: true,
                });
                return preferred;
            }

            const candidates = [...element.querySelectorAll('span, div, p')];
            const fallback = candidates.find(node => {
                if (node.querySelector('[data-testid="username"], [data-testid="chat-message-username"]')) {
                    return false;
                }
                const text = normalizeWhitespace(node.textContent || '');
                return text.length > 0 && text.length < normalizeWhitespace(element.textContent || '').length;
            }) || null;
            this.emitTelemetry('selectorMatched', {
                method: 'resolveMessageTextNode',
                selector: '<fallback-span-div-p>',
                found: Boolean(fallback),
                domSnapshot: fallback
                    ? null
                    : this.captureDomSnapshot('resolve-message-text-node-missing', element, {
                        includePrevSibling: true,
                        includeNextSibling: true,
                    }),
            }, fallback ? 'debug' : 'warn');
            return fallback;
        }

        resolveMessageTimestamp(element) {
            if (!element) return '';
            return element.getAttribute('data-ts')
                || element.querySelector('[data-ts]')?.getAttribute('data-ts')
                || element.closest('[data-ts]')?.getAttribute('data-ts')
                || '';
        }

        isPrivateMessageContainer(container) {
            if (!container) return false;

            const hasBackButton = !!container.querySelector('[data-testid="back-to-conversation-list-button"]');
            const hasPmInput = !!container.querySelector('.theatermodeInputFieldPm, [data-testid="chat-input"].theatermodeInputFieldPm');
            const hasPmSendButton = !!container.querySelector('[data-testid="send-button"].pm, .SendButton.SplitMode.pm');
            const hasPmHeader = [...container.querySelectorAll('[data-testid="chat-message"]')]
                .some(el => {
                    const text = normalizeWhitespace(el.textContent);
                    return text.startsWith('Conversación privada con ') || text.startsWith('Private conversation with ');
                });

            return hasBackButton || hasPmInput || hasPmSendButton || hasPmHeader;
        }

        getConversationRoot() {
            const container = this.findOpenPmContainer();
            if (!container) return null;

            const messageList = this.resolveMessageList(container);
            if (!messageList) return null;

            return container;
        }

        getMessageList() {
            const container = this.findOpenPmContainer();
            return container ? this.resolveMessageList(container) : null;
        }

        getComposerInput() {
            const container = this.findOpenPmContainer();
            return container
                ? container.querySelector('[data-testid="chat-input"].theatermodeInputFieldPm, .theatermodeInputFieldPm[data-testid="chat-input"]')
                : null;
        }

        getSendButton() {
            const container = this.findOpenPmContainer();
            return container
                ? container.querySelector('[data-testid="send-button"].pm, .SendButton.SplitMode.pm[data-testid="send-button"]')
                : null;
        }

        getMediaDock() {
            const container = this.findOpenPmContainer();
            return container
                ? container.querySelector('.pmMediaDockContainer.SelectedMediaDock, .pmMediaDockContainer')
                : null;
        }

        getControlBar() {
            const container = this.findOpenPmContainer();
            return container
                ? container.querySelector('#pm-control-bar, .PMControlBar.pm-control-bar')
                : null;
        }

        getOutgoingLanguageHost() {
            return document.querySelector('#roomTabs');
        }

        getMessageElements() {
            const messageList = this.getMessageList();
            if (!messageList) {
                this.emitTelemetry('messageElementsMissingList', {
                    method: 'getMessageElements',
                    domSnapshot: this.captureDomSnapshot('get-message-elements-missing-list', this.getConversationRoot() || document.body, {
                        includeParent: false,
                    }),
                }, 'warn');
                return [];
            }

            const seen = new Set();
            const elements = [...messageList.querySelectorAll('[data-testid="chat-message"], [data-ts][data-nick], [data-nick][data-testid], [data-nick]')]
                .filter(element => {
                    if (!(element instanceof HTMLElement)) return false;
                    if (seen.has(element)) return false;
                    seen.add(element);
                    if (!this.resolveMessageTextNode(element)) return false;
                    const text = normalizeWhitespace(element.textContent || '');
                    if (!text) return false;
                    return !(
                        text.startsWith('Conversación privada con ') ||
                        text.startsWith('Private conversation with ')
                    );
                });
            this.emitTelemetry('messageElementsResolved', {
                method: 'getMessageElements',
                count: elements.length,
            });
            return elements;
        }

        getConversationIdentity() {
            const scope = this.getConversationRoot() || document;
            const header = [...scope.querySelectorAll('[data-testid="chat-message"]')]
                .map(el => normalizeWhitespace(el.textContent))
                .find(text =>
                    text.startsWith('Conversación privada con ') ||
                    text.startsWith('Private conversation with ')
                );
            return header || `${location.pathname}::pm-unknown`;
        }

        parseMessageElement(element) {
            const usernameNode = element.querySelector('[data-testid="chat-message-username"] [data-testid="username"], [data-testid="chat-message-username"], [data-testid="username"]');
            const textNode = this.resolveMessageTextNode(element);
            const sourceText = textNode?.dataset.qtsOriginalText || textNode?.querySelector('[data-qts-message-content="1"]')?.textContent || textNode?.textContent || '';
            const authorName = normalizeWhitespace(usernameNode?.textContent || element.getAttribute('data-nick') || '');
            const text = normalizeWhitespace(sourceText);
            const timestamp = this.resolveMessageTimestamp(element);

            if (!authorName || !text || !textNode) {
                this.emitTelemetry('parseMessageElementFailed', {
                    method: 'parseMessageElement',
                    authorName,
                    text,
                    timestamp,
                    textNodePresent: Boolean(textNode),
                    element,
                    domSnapshot: this.captureDomSnapshot('parse-message-element-failed', element, {
                        includeParent: true,
                        includePrevSibling: true,
                        includeNextSibling: true,
                    }),
                }, 'warn');
                return null;
            }

            const selfUsername = this.getSelfUsername();
            const direction = selfUsername && authorName.toLowerCase() === selfUsername ? 'outgoing' : 'incoming';

            return {
                id: buildMessageId({ authorName, timestamp, text }),
                authorKey: authorName.toLowerCase(),
                authorName,
                text,
                timestamp,
                direction,
                root: element,
                textNode,
            };
        }
    }

    /**
     * Adaptador específico para Stripchat.
     * Implementa la lógica para encontrar y manipular el DOM de los chats
     * adaptándose a la estructura y eventos de Stripchat (solo mensajes salientes).
     */
    class StripchatPmAdapter extends BaseSiteAdapter {
        constructor() {
            super('stripchat-pm');
        }

        isSupported() {
            return /stripchat\.com$/i.test(location.hostname);
        }

        getSelfUsername() {
            return 'self';
        }

        isVisiblePmContainer(container) {
            if (!(container instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(container);
            const rect = container.getBoundingClientRect();
            if (style.display === 'none' || style.visibility === 'hidden') {
                return false;
            }
            return rect.width > 0 && rect.height > 0;
        }

        isPrivateMessageContainer(container) {
            if (!(container instanceof HTMLElement)) return false;
            return Boolean(
                container.querySelector('.content-messages')
                && container.querySelector('textarea[placeholder*="Mensaje privado"], textarea[placeholder*="Private message"], .ChatInput__input, .chat-input textarea')
                && container.querySelector('.messenger-chat-header')
            );
        }

        findOpenPmContainer() {
            const candidates = [
                ...document.querySelectorAll('.expanded.messenger-chat, .messenger-chat.expanded, .messenger-chat')
            ].filter(candidate => this.isPrivateMessageContainer(candidate));
            const selected = candidates.find(candidate => this.isVisiblePmContainer(candidate))
                || candidates[0]
                || null;
            this.emitTelemetry('findOpenPmContainer', {
                method: 'findOpenPmContainer',
                candidateCount: candidates.length,
                found: Boolean(selected),
                selected,
                domSnapshot: selected
                    ? null
                    : this.captureDomSnapshot('find-open-pm-container-missing', document.body, {
                        includeParent: false,
                        extra: {
                            candidateSelectors: [
                                '.expanded.messenger-chat',
                                '.messenger-chat.expanded',
                                '.messenger-chat',
                            ],
                        },
                    }),
            }, selected ? 'debug' : 'warn');
            return selected;
        }

        getConversationRoot() {
            return this.findOpenPmContainer();
        }

        getMessageList() {
            return this.getConversationRoot()?.querySelector('.content-messages') || null;
        }

        getComposerInput() {
            return this.getConversationRoot()?.querySelector(
                'textarea[placeholder*="Mensaje privado"], textarea[placeholder*="Private message"], .ChatInput__input, .chat-input textarea'
            ) || null;
        }

        getSendButton() {
            const root = this.getConversationRoot();
            if (!root) return null;

            const selectors = [
                'button[aria-label="Enviar"]',
                'button[aria-label="Send"]',
                '.ChatInput__sendBtn',
                '[class*="ChatInput__sendBtn"]',
                '.chat-input button[type="submit"]',
            ];

            for (const selector of selectors) {
                const match = root.querySelector(selector);
                if (match) {
                    this.emitTelemetry('selectorMatched', {
                        method: 'getSendButton',
                        selector,
                        found: true,
                    });
                    return match;
                }
            }

            this.emitTelemetry('selectorMatched', {
                method: 'getSendButton',
                selector: selectors,
                found: false,
                domSnapshot: this.captureDomSnapshot('get-send-button-missing', root, {
                    includeParent: true,
                    extra: { selectors },
                }),
            }, 'warn');
            return null;
        }

        getMediaDock() {
            return this.getComposerInput()?.closest('.ChatInput__wrapper, .chat-input, [class*="ChatInput__wrapper"]') || null;
        }

        getControlBar() {
            return this.getConversationRoot()?.querySelector('.messenger-chat-header .chat-header-content, .messenger-chat-header') || null;
        }

        getOutgoingLanguageHost() {
            return this.getConversationRoot()?.querySelector('.chat-controls.content-controls') || null;
        }

        supportsIncomingTranslation() {
            return false;
        }

        getCounterpartUsername() {
            const root = this.getConversationRoot();
            const href = root?.querySelector('.messenger-chat-header a[href^="/user/"]')?.getAttribute('href') || '';
            const hrefMatch = href.match(/^\/user\/([^/?#]+)/i);
            if (hrefMatch) return hrefMatch[1].toLowerCase();

            const headerText = normalizeWhitespace(root?.querySelector('.messenger-chat-header')?.textContent || '');
            const textMatch = headerText.match(/([a-z0-9._-]{2,})$/i);
            return textMatch ? textMatch[1].toLowerCase() : 'counterpart';
        }

        resolveMessageTimestamp(element) {
            const directId = element?.getAttribute('data-message-id') || '';
            if (directId) return directId;

            const anchorId = element?.querySelector('[id^="private-chat-"][id$="-messenger"]')?.id || '';
            const match = anchorId.match(/private-chat-(\d+)-messenger/i);
            return match ? match[1] : '';
        }

        getMessageElements() {
            const messageList = this.getMessageList();
            if (!messageList) {
                this.emitTelemetry('messageElementsMissingList', {
                    method: 'getMessageElements',
                    domSnapshot: this.captureDomSnapshot('get-message-elements-missing-list', this.getConversationRoot() || document.body, {
                        includeParent: false,
                    }),
                }, 'warn');
                return [];
            }

            const elements = [...messageList.querySelectorAll('.base-message-wrapper')]
                .filter(element => {
                    if (!(element instanceof HTMLElement)) return false;
                    const textNode = element.querySelector('.TextMessage__counterpart, .TextMessage__own, .base-message');
                    const text = extractMessageTextFromNode(textNode);
                    return Boolean(text);
                });
            this.emitTelemetry('messageElementsResolved', {
                method: 'getMessageElements',
                count: elements.length,
            });
            return elements;
        }

        getConversationIdentity() {
            return `stripchat-pm::${this.getCounterpartUsername()}`;
        }

        parseMessageElement(element) {
            const textNode = element.querySelector('.TextMessage__counterpart, .TextMessage__own, .base-message');
            const text = extractMessageTextFromNode(textNode);
            const timestamp = this.resolveMessageTimestamp(element);
            const isOutgoing = element.className.includes('position-right') || element.className.includes('OwnBaseMessage');
            const authorName = isOutgoing ? this.getSelfUsername() : this.getCounterpartUsername();
            const direction = isOutgoing ? 'outgoing' : 'incoming';

            if (!authorName || !text || !textNode) {
                this.emitTelemetry('parseMessageElementFailed', {
                    method: 'parseMessageElement',
                    authorName,
                    text,
                    timestamp,
                    textNodePresent: Boolean(textNode),
                    element,
                    domSnapshot: this.captureDomSnapshot('parse-message-element-failed', element, {
                        includeParent: true,
                        includePrevSibling: true,
                        includeNextSibling: true,
                    }),
                }, 'warn');
                return null;
            }

            return {
                id: buildMessageId({ authorName, timestamp, text }),
                authorKey: authorName.toLowerCase(),
                authorName,
                text,
                timestamp,
                direction,
                root: element,
                textNode,
            };
        }
    }

    /**
     * Controlador Principal de Traducción.
     * Es el cerebro del script: une el adaptador de DOM, el traductor y el almacenamiento.
     * Supervisa los cambios de la página (MutationObserver), detecta conversaciones nuevas,
     * gestiona el renderizado de la UI y coordina las colas de mensajes a traducir.
     */
    class TranslationController {
        constructor(adapter, translator, store = null) {
            this.adapter = adapter;
            this.translator = translator;
            this.state = loadState();
            this.messageObserver = null;
            this.pageObserver = null;
            this.currentMessageList = null;
            this.currentConversationKey = null;
            this.pendingByAuthor = new Map();
            this.pendingTimer = null;
            this.currentComposerInput = null;
            this.currentSendButton = null;
            this.currentMediaDock = null;
            this.currentControlBar = null;
            this.currentOutgoingLanguageHost = null;
            this.isSendingTranslatedMessage = false;
            this.allowNativeSendClick = false;
            this.outgoingMessageStore = store || new OutgoingMessageStore();
            this.outgoingTranslationMemory = [];
            this.persistedOutgoingTranslationCache = new Map();
            this.missingOutgoingTranslationKeys = new Set();
            this.detectedLanguageCache = new Map();
            this.incomingSettingsCache = new Map();
            this.initialBacklogPending = false;
            this.isProcessingInitialBacklog = false;
            this.currentConversationInitialized = false;
            this.hydratedConversationKey = null;
            this.recordingButton = null;
            this.handleComposerKeyDown = this.handleComposerKeyDown.bind(this);
            this.handleSendButtonClick = this.handleSendButtonClick.bind(this);
            this.handleRecordingButtonClick = this.handleRecordingButtonClick.bind(this);
            this.handleRecordingStateChanged = this.handleRecordingStateChanged.bind(this);
        }

        captureDomSnapshot(signature, node, options = {}) {
            return captureDomSnapshot(`${this.adapter.siteId}:${signature}`, node, options);
        }

        start() {
            telemetry.capture('controller.start', {
                siteId: this.adapter.siteId,
            }, 'info');
            ensureStyles();
            this.ensureRecordingButton();
            window.addEventListener('qts-telemetry-recording-changed', this.handleRecordingStateChanged);
            this.outgoingMessageStore.purgeExpired().catch(() => {});
            this.observePage();
            this.tick();
            setInterval(() => this.tick(), CONFIG.rootPollMs);
        }

        observePage() {
            if (this.pageObserver) {
                this.pageObserver.disconnect();
            }
            telemetry.capture('controller.observePage.start', {
                siteId: this.adapter.siteId,
            });

            this.pageObserver = new MutationObserver(() => {
                telemetry.capture('controller.observePage.mutation', {
                    siteId: this.adapter.siteId,
                });
                telemetry.captureRecordingMutation('controller.observePage.mutation', {
                    siteId: this.adapter.siteId,
                });
                if (this.tickTimer) clearTimeout(this.tickTimer);
                this.tickTimer = setTimeout(() => this.tick(), CONFIG.observerSettleMs);
            });

            this.pageObserver.observe(document.documentElement || document.body, {
                childList: true,
                subtree: true,
            });
        }

        async hydrateIncomingSettings() {
            if (!this.currentConversationKey) {
                this.state.settings = createDefaultConversationSettings();
                telemetry.capture('controller.hydrateIncomingSettings.defaulted', {
                    reason: 'missing-conversation-key',
                    siteId: this.adapter.siteId,
                }, 'warn');
                return;
            }

            const settingsKey = buildIncomingSettingsKey(this.adapter.siteId, this.currentConversationKey);
            const stored = await this.outgoingMessageStore.getIncomingSettings(settingsKey);
            const nextSettings = createDefaultConversationSettings();

            if (stored) {
                this.incomingSettingsCache.set(settingsKey, stored);
                if (typeof stored.translationEnabled === 'boolean') {
                    nextSettings.translationEnabled = stored.translationEnabled;
                }
                if (typeof stored.outgoingTranslationEnabled === 'boolean') {
                    nextSettings.outgoingTranslationEnabled = stored.outgoingTranslationEnabled;
                }
                if (isSupportedTargetLanguage(stored.targetLanguage)) {
                    nextSettings.targetLanguage = stored.targetLanguage;
                }
                if (isSupportedOutgoingTargetLanguage(stored.outgoingTargetLanguage)) {
                    nextSettings.outgoingTargetLanguage = stored.outgoingTargetLanguage;
                }
            }

            this.state.settings = nextSettings;
            saveState(this.state);
            this.hydratedConversationKey = this.currentConversationKey;
            telemetry.capture('controller.hydrateIncomingSettings.completed', {
                siteId: this.adapter.siteId,
                conversationKey: this.currentConversationKey,
                settingsKey,
                stored,
                nextSettings,
            }, 'info');
            this.updatePmToggleUi();
            this.updateOutgoingToggleUi();
            this.updateOutgoingLanguageUi();
        }

        persistIncomingSettings() {
            if (!this.currentConversationKey) return;

            const settingsKey = buildIncomingSettingsKey(this.adapter.siteId, this.currentConversationKey);
            const record = {
                settingsKey,
                siteId: this.adapter.siteId,
                conversationKey: this.currentConversationKey,
                translationEnabled: isTranslationEnabled(this.state),
                outgoingTranslationEnabled: isOutgoingTranslationEnabled(this.state),
                targetLanguage: getConfiguredTargetLanguage(this.state),
                outgoingTargetLanguage: getConfiguredOutgoingTargetLanguage(this.state),
                updatedAt: Date.now(),
            };
            this.incomingSettingsCache.set(settingsKey, record);
            telemetry.capture('controller.persistIncomingSettings', {
                siteId: this.adapter.siteId,
                conversationKey: this.currentConversationKey,
                record,
            }, 'info');
            this.outgoingMessageStore.putIncomingSettings(record).catch(() => {});
        }

        async warmDetectedLanguages(authorKeys) {
            const uniqueAuthorKeys = [...new Set((authorKeys || []).filter(Boolean))];
            if (!uniqueAuthorKeys.length) return;

            await Promise.all(uniqueAuthorKeys.map(async authorKey => {
                const profileKey = buildDetectedLanguageKey(this.adapter.siteId, authorKey);
                if (!profileKey || this.detectedLanguageCache.has(profileKey)) return;

                const stored = await this.outgoingMessageStore.getDetectedLanguage(profileKey);
                if (!stored) return;

                this.detectedLanguageCache.set(profileKey, stored);
                const profile = this.getUserProfile(authorKey);
                if (!profile.detectedLanguage && stored.detectedLanguage) {
                    profile.detectedLanguage = stored.detectedLanguage;
                    profile.updatedAt = Number(stored.updatedAt || Date.now());
                }
            }));
        }

        describeMessageList(messageList) {
            if (!(messageList instanceof Element)) {
                return {
                    present: false,
                    className: '',
                    hasMessageNodes: false,
                    isLoadingWrapper: false,
                };
            }

            const className = String(messageList.className || '');
            const text = normalizeWhitespace(messageList.textContent || '');
            const hasMessageNodes = Boolean(messageList.querySelector('[data-testid="chat-message"], [data-ts][data-nick], [data-nick][data-testid], [data-nick]'));
            const isLoadingWrapper =
                className.includes('msg-list-wrapper-split') &&
                /Cargando más mensajes|Loading more messages/i.test(text);

            return {
                present: true,
                className,
                hasMessageNodes,
                isLoadingWrapper,
            };
        }

        bootstrapConversation(messageList, conversationKey, reason = 'change', diagnostics = {}) {
            log('Conversation bootstrap', { conversationKey, reason });
            telemetry.capture('controller.conversationChanged', {
                siteId: this.adapter.siteId,
                previousConversationKey: this.currentConversationKey,
                nextConversationKey: conversationKey,
                reason,
                diagnostics,
            }, 'info');
            telemetry.recordDetailedSnapshot('controller.conversationChanged', {
                siteId: this.adapter.siteId,
                previousConversationKey: this.currentConversationKey,
                nextConversationKey: conversationKey,
                reason,
                diagnostics,
            });
            this.currentMessageList = messageList;
            this.currentConversationKey = conversationKey;
            this.currentConversationInitialized = true;
            this.hydratedConversationKey = null;
            this.state.settings = createDefaultConversationSettings();
            this.initialBacklogPending = true;
            this.isProcessingInitialBacklog = false;
            this.resetObserver();
            this.observeMessageList(messageList);
            this.hydrateIncomingSettings()
                .catch(error => console.error('[qtranslate-script] settings hydration failed', error))
                .finally(() => {
                    this.ensureInitialBacklogProcessed(`conversation-${reason}`).catch(error => console.error('[qtranslate-script] backlog failed', error));
                });
        }

        tick() {
            this.updateRecordingButtonUi();
            const root = this.adapter.getConversationRoot();
            telemetry.capture('controller.tick', {
                siteId: this.adapter.siteId,
                hasRoot: Boolean(root),
                currentConversationKey: this.currentConversationKey,
            });
            if (!root) {
                if (this.currentMessageList || this.currentConversationKey) {
                    log('No private conversation is open right now');
                    telemetry.capture('controller.tick.noConversation', {
                        siteId: this.adapter.siteId,
                        previousConversationKey: this.currentConversationKey,
                    }, 'warn');
                    telemetry.recordDetailedSnapshot('controller.tick.noConversation', {
                        siteId: this.adapter.siteId,
                        previousConversationKey: this.currentConversationKey,
                    }, 'warn');
                    this.resetConversationState();
                }
                return;
            }

            const conversationKey = this.adapter.getConversationIdentity();
            const messageList = this.adapter.getMessageList();
            if (!messageList) {
                telemetry.capture('controller.tick.noMessageList', {
                    siteId: this.adapter.siteId,
                    conversationKey,
                    domSnapshot: this.captureDomSnapshot('tick-no-message-list', root, {
                        includeParent: true,
                    }),
                }, 'warn');
                telemetry.recordDetailedSnapshot('controller.tick.noMessageList', {
                    siteId: this.adapter.siteId,
                    conversationKey,
                }, 'warn');
                this.resetConversationState();
                return;
            }

            if (!this.isIncomingTranslationActive()) {
                removeBacklogProgress(messageList);
            }

            this.ensureComposerBindings();

            const currentMessageListState = this.describeMessageList(this.currentMessageList);
            const nextMessageListState = this.describeMessageList(messageList);
            const isConversationChanged =
                this.currentMessageList !== messageList ||
                this.currentConversationKey !== conversationKey;
            const shouldRepairBootstrap =
                Boolean(conversationKey && messageList) &&
                (
                    !this.currentConversationInitialized ||
                    this.hydratedConversationKey !== conversationKey ||
                    (
                        this.currentMessageList !== messageList &&
                        nextMessageListState.hasMessageNodes &&
                        (currentMessageListState.isLoadingWrapper || !currentMessageListState.hasMessageNodes)
                    )
                );

            if (isConversationChanged || shouldRepairBootstrap) {
                this.bootstrapConversation(
                    messageList,
                    conversationKey,
                    isConversationChanged ? 'change' : 'repair',
                    {
                        currentMessageListState,
                        nextMessageListState,
                        currentConversationInitialized: this.currentConversationInitialized,
                        hydratedConversationKey: this.hydratedConversationKey,
                    }
                );
                return;
            }

            this.ensureInitialBacklogProcessed('tick').catch(error => console.error('[qtranslate-script] backlog failed', error));
        }

        resetConversationState() {
            telemetry.capture('controller.resetConversationState', {
                siteId: this.adapter.siteId,
                currentConversationKey: this.currentConversationKey,
            }, 'info');
            this.resetObserver();
            this.currentMessageList = null;
            this.currentConversationKey = null;
            this.state.settings = createDefaultConversationSettings();
            this.pendingByAuthor.clear();
            this.detachComposerBindings();
            if (this.pendingTimer) {
                clearTimeout(this.pendingTimer);
                this.pendingTimer = null;
            }
            this.initialBacklogPending = false;
            this.isProcessingInitialBacklog = false;
            this.currentConversationInitialized = false;
            this.hydratedConversationKey = null;
        }

        resetObserver() {
            if (this.messageObserver) {
                this.messageObserver.disconnect();
                this.messageObserver = null;
            }
        }

        ensureComposerBindings() {
            const nextInput = this.adapter.getComposerInput();
            const nextButton = this.adapter.getSendButton();
            const nextMediaDock = this.adapter.getMediaDock();
            const nextControlBar = this.adapter.getControlBar();
            const nextOutgoingLanguageHost = this.adapter.getOutgoingLanguageHost();
            telemetry.capture('controller.ensureComposerBindings', {
                siteId: this.adapter.siteId,
                hasNextInput: Boolean(nextInput),
                hasNextButton: Boolean(nextButton),
                hasNextMediaDock: Boolean(nextMediaDock),
                hasNextControlBar: Boolean(nextControlBar),
                hasNextOutgoingLanguageHost: Boolean(nextOutgoingLanguageHost),
                domSnapshot: (!nextInput || !nextButton)
                    ? this.captureDomSnapshot('ensure-composer-bindings-missing-pieces', this.adapter.getConversationRoot() || document.body, {
                        includeParent: false,
                        extra: {
                            missing: {
                                input: !nextInput,
                                button: !nextButton,
                                mediaDock: !nextMediaDock,
                                controlBar: !nextControlBar,
                                outgoingLanguageHost: !nextOutgoingLanguageHost,
                            },
                        },
                    })
                    : null,
            });
            if (this.currentComposerInput !== nextInput) {
                if (this.currentComposerInput) {
                    this.currentComposerInput.removeEventListener('keydown', this.handleComposerKeyDown, true);
                }
                this.currentComposerInput = nextInput;
                if (this.currentComposerInput) {
                    this.currentComposerInput.addEventListener('keydown', this.handleComposerKeyDown, true);
                }
            }

            if (this.currentSendButton !== nextButton) {
                if (this.currentSendButton) {
                    this.currentSendButton.removeEventListener('click', this.handleSendButtonClick, true);
                }
                this.currentSendButton = nextButton;
                if (this.currentSendButton) {
                    this.currentSendButton.addEventListener('click', this.handleSendButtonClick, true);
                }
            }

            if (this.currentMediaDock !== nextMediaDock) {
                this.currentMediaDock = nextMediaDock;
                this.renderOutgoingToggle();
            } else if (this.currentMediaDock) {
                this.renderOutgoingToggle();
            }

            if (this.currentControlBar !== nextControlBar) {
                this.currentControlBar = nextControlBar;
                this.renderPmToggle();
            } else if (this.currentControlBar) {
                this.renderPmToggle();
            }

            if (this.currentOutgoingLanguageHost !== nextOutgoingLanguageHost) {
                this.currentOutgoingLanguageHost = nextOutgoingLanguageHost;
                this.renderOutgoingLanguageSelector();
            } else if (this.currentOutgoingLanguageHost) {
                this.renderOutgoingLanguageSelector();
            }
        }

        detachComposerBindings() {
            if (this.currentComposerInput) {
                this.currentComposerInput.removeEventListener('keydown', this.handleComposerKeyDown, true);
                this.currentComposerInput = null;
            }
            if (this.currentSendButton) {
                this.currentSendButton.removeEventListener('click', this.handleSendButtonClick, true);
                this.currentSendButton = null;
            }
            this.currentMediaDock = null;
            this.currentControlBar = null;
            this.currentOutgoingLanguageHost?.querySelector('[data-qts-outgoing-language-wrap="1"]')?.remove();
            this.currentOutgoingLanguageHost = null;
            this.isSendingTranslatedMessage = false;
            this.allowNativeSendClick = false;
        }

        ensureRecordingButton() {
            if (!CONFIG.telemetry.enabled) {
                const button = document.querySelector('[data-qts-recording-button="1"]');
                if (button) button.remove();
                this.recordingButton = null;
                return;
            }

            let button = document.querySelector('[data-qts-recording-button="1"]');
            if (!button) {
                button = document.createElement('button');
                button.type = 'button';
                button.dataset.qtsRecordingButton = '1';
                button.innerHTML = '<span data-qts-recording-dot="1"></span><span data-qts-recording-label="1">Record trace</span>';
                button.addEventListener('click', this.handleRecordingButtonClick);
                document.body.appendChild(button);
            }
            this.recordingButton = button;
            this.updateRecordingButtonUi();
        }

        handleRecordingButtonClick(event) {
            event.preventDefault();
            event.stopPropagation();
            if (telemetry.isRecording()) {
                telemetry.stopRecording('manual-stop');
            } else {
                telemetry.startRecording('manual-button', {
                    origin: location.href,
                });
            }
            this.updateRecordingButtonUi();
        }

        handleRecordingStateChanged() {
            this.updateRecordingButtonUi();
        }

        updateRecordingButtonUi() {
            this.recordingButton = this.recordingButton && document.contains(this.recordingButton)
                ? this.recordingButton
                : document.querySelector('[data-qts-recording-button="1"]');

            if (!this.recordingButton || !document.body) {
                return;
            }

            const active = telemetry.isRecording();
            const remainingSeconds = Math.ceil(telemetry.getRecordingRemainingMs() / 1000);
            const labelNode = this.recordingButton.querySelector('[data-qts-recording-label="1"]');

            this.recordingButton.dataset.active = active ? 'true' : 'false';
            this.recordingButton.setAttribute('aria-pressed', active ? 'true' : 'false');
            this.recordingButton.title = active
                ? `Recording trace: on (${remainingSeconds}s left)`
                : 'Start recording a high-detail trace';

            if (labelNode) {
                labelNode.textContent = active
                    ? `Recording ${remainingSeconds}s`
                    : 'Record trace';
            }
        }

        renderOutgoingToggle() {
            const composerToolbar = this.currentComposerInput?.closest('.inputDiv');
            const imageButton = composerToolbar?.querySelector('[data-testid="send-image-button"], [data-paction-name="UploadPhoto"]')
                || this.currentMediaDock?.querySelector('[data-testid="send-image-button"], [data-paction-name="UploadPhoto"]')
                || document.querySelector('[data-testid="send-image-button"], [data-paction-name="UploadPhoto"]');
            const visibleAnchorParent = imageButton?.parentElement || composerToolbar?.querySelector('div[style*="display: flex"]');
            const fallbackParent = visibleAnchorParent
                || composerToolbar
                || this.currentMediaDock?.querySelector('.noScrollbar > div, .noScrollbar')
                || this.currentMediaDock;

            if (!fallbackParent) {
                telemetry.capture('ui.renderOutgoingToggle.missingHost', {
                    siteId: this.adapter.siteId,
                    composerToolbar,
                    mediaDock: this.currentMediaDock,
                    imageButton,
                    domSnapshot: this.captureDomSnapshot('render-outgoing-toggle-missing-host', this.adapter.getConversationRoot() || document.body, {
                        includeParent: false,
                    }),
                }, 'warn');
                return;
            }

            let button = document.querySelector('[data-qts-pm-outgoing-toggle="1"]');
            if (!button) {
                button = document.createElement('button');
                button.type = 'button';
                button.dataset.qtsPmOutgoingToggle = '1';
                button.innerHTML = TRANSLATION_TOGGLE_SVG;
                button.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    const enabled = !isOutgoingTranslationEnabled(this.state);
                    setOutgoingTranslationEnabled(this.state, enabled);
                    this.persistIncomingSettings();
                    this.updateOutgoingToggleUi();
                });
            }

            const targetParent = fallbackParent;
            if (imageButton) {
                if (button.previousElementSibling !== imageButton || button.parentElement !== imageButton.parentElement) {
                    imageButton.insertAdjacentElement('afterend', button);
                }
            } else if (button.parentElement !== targetParent) {
                targetParent.appendChild(button);
            }

            telemetry.capture('ui.renderOutgoingToggle.completed', {
                siteId: this.adapter.siteId,
                targetParent,
                hasImageButton: Boolean(imageButton),
            });

            this.updateOutgoingToggleUi();
        }

        updateOutgoingToggleUi() {
            const button = this.currentComposerInput?.closest('.inputDiv')?.querySelector('[data-qts-pm-outgoing-toggle="1"]')
                || document.querySelector('[data-qts-pm-outgoing-toggle="1"]');
            if (!button) return;

            const enabled = isOutgoingTranslationEnabled(this.state);
            const targetLanguage = getConfiguredOutgoingTargetLanguage(this.state);
            const targetLabel = getTargetLanguageLabel(targetLanguage);
            button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
            button.setAttribute('aria-label', enabled ? `Disable outgoing translation to ${targetLabel}` : `Enable outgoing translation to ${targetLabel}`);
            button.title = enabled ? `Outgoing translation: ${targetLabel} (on)` : `Outgoing translation: ${targetLabel} (off)`;
            button.classList.toggle('LbQPloYMQSit0_FMAd1n', enabled);
        }

        renderOutgoingLanguageSelector() {
            if (!this.currentOutgoingLanguageHost) {
                telemetry.capture('ui.renderOutgoingLanguageSelector.missingHost', {
                    siteId: this.adapter.siteId,
                    domSnapshot: this.captureDomSnapshot('render-outgoing-language-selector-missing-host', this.adapter.getConversationRoot() || document.body, {
                        includeParent: false,
                    }),
                }, 'warn');
                return;
            }

            let wrap = this.currentOutgoingLanguageHost.querySelector('[data-qts-outgoing-language-wrap="1"]');
            if (!wrap) {
                wrap = document.createElement('div');
                wrap.dataset.qtsOutgoingLanguageWrap = '1';

                const label = document.createElement('span');
                label.dataset.qtsOutgoingLanguageLabel = '1';
                label.textContent = 'Send as';

                const select = document.createElement('select');
                select.dataset.qtsOutgoingLanguageSelect = '1';
                select.setAttribute('aria-label', 'Select outgoing translation target language');
                select.addEventListener('change', event => {
                    event.stopPropagation();
                    setOutgoingTargetLanguage(this.state, select.value);
                    this.persistIncomingSettings();
                    this.updateOutgoingLanguageUi();
                    this.updateOutgoingToggleUi();
                });

                for (const optionData of OUTGOING_LANGUAGE_OPTIONS) {
                    const option = document.createElement('option');
                    option.value = optionData.code;
                    option.textContent = optionData.label;
                    select.appendChild(option);
                }

                wrap.appendChild(label);
                wrap.appendChild(select);

                const tabBar = this.currentOutgoingLanguageHost.querySelector('.tabBar');
                const chatControlsContent = this.currentOutgoingLanguageHost.querySelector('.chat-controls-content');
                if (tabBar?.parentElement === this.currentOutgoingLanguageHost) {
                    tabBar.insertAdjacentElement('afterend', wrap);
                } else if (chatControlsContent?.parentElement === this.currentOutgoingLanguageHost) {
                    chatControlsContent.insertAdjacentElement('afterend', wrap);
                } else if (this.currentOutgoingLanguageHost.matches('.chat-header-content, .messenger-chat-header, .chat-controls-content')) {
                    this.currentOutgoingLanguageHost.appendChild(wrap);
                } else {
                    this.currentOutgoingLanguageHost.prepend(wrap);
                }
            }

            telemetry.capture('ui.renderOutgoingLanguageSelector.completed', {
                siteId: this.adapter.siteId,
                host: this.currentOutgoingLanguageHost,
            });
            this.updateOutgoingLanguageUi();
        }

        updateOutgoingLanguageUi() {
            const select = this.currentOutgoingLanguageHost?.querySelector('[data-qts-outgoing-language-select="1"]');
            if (!select) return;

            const targetLanguage = getConfiguredOutgoingTargetLanguage(this.state);
            select.value = targetLanguage;
            select.title = `Outgoing translation target: ${getTargetLanguageLabel(targetLanguage)}`;
        }

        renderPmToggle() {
            if (!this.currentControlBar) {
                telemetry.capture('ui.renderPmToggle.missingControlBar', {
                    siteId: this.adapter.siteId,
                    domSnapshot: this.captureDomSnapshot('render-pm-toggle-missing-control-bar', this.adapter.getConversationRoot() || document.body, {
                        includeParent: false,
                    }),
                }, 'warn');
                return;
            }
            if (!this.adapter.supportsIncomingTranslationUi()) {
                this.currentControlBar.querySelector('[data-qts-pm-toggle-wrap="1"]')?.remove();
                telemetry.capture('ui.renderPmToggle.removedUnsupported', {
                    siteId: this.adapter.siteId,
                });
                return;
            }

            let wrap = this.currentControlBar.querySelector('[data-qts-pm-toggle-wrap="1"]');
            if (!wrap) {
                wrap = document.createElement('span');
                wrap.dataset.qtsPmToggleWrap = '1';

                const select = document.createElement('select');
                select.dataset.qtsPmTargetSelect = '1';
                select.setAttribute('aria-label', 'Select translation target language');
                select.addEventListener('click', event => {
                    event.stopPropagation();
                });
                select.addEventListener('change', event => {
                    event.stopPropagation();
                    setTargetLanguage(this.state, select.value);
                    this.persistIncomingSettings();
                    this.updatePmToggleUi();
                    this.retranslateCurrentChat();
                });

                for (const optionData of BING_LANGUAGE_OPTIONS) {
                    const option = document.createElement('option');
                    option.value = optionData.code;
                    option.textContent = optionData.label;
                    select.appendChild(option);
                }

                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'ebCySkD4Gv8pQdxw8kqa';
                button.dataset.qtsPmToggleButton = '1';
                button.innerHTML = TRANSLATION_TOGGLE_SVG;
                button.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    const enabled = !isTranslationEnabled(this.state);
                    setTranslationEnabled(this.state, enabled);
                    this.persistIncomingSettings();
                    this.handleTranslationToggleChange(enabled);
                });

                wrap.appendChild(select);
                wrap.appendChild(button);
                this.currentControlBar.appendChild(wrap);
            }

            telemetry.capture('ui.renderPmToggle.completed', {
                siteId: this.adapter.siteId,
            });
            this.updatePmToggleUi();
        }

        updatePmToggleUi() {
            const button = this.currentControlBar?.querySelector('[data-qts-pm-toggle-button="1"]');
            const select = this.currentControlBar?.querySelector('[data-qts-pm-target-select="1"]');
            if (!button || !select) return;
            const enabled = isTranslationEnabled(this.state);
            const configuredTarget = getConfiguredTargetLanguage(this.state);
            const effectiveTarget = getEffectiveTargetLanguage(this.state);
            select.value = configuredTarget;
            select.title = configuredTarget === 'auto'
                ? `Auto-detect (${getTargetLanguageLabel(effectiveTarget)})`
                : getTargetLanguageLabel(effectiveTarget);
            button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
            button.setAttribute('aria-label', enabled ? 'Disable translation in this chat' : 'Enable translation in this chat');
            button.title = enabled ? 'Translation in this chat: on' : 'Translation in this chat: off';
            button.classList.toggle('LbQPloYMQSit0_FMAd1n', enabled);
        }

        handleTranslationToggleChange(enabled) {
            telemetry.capture('controller.handleTranslationToggleChange', {
                siteId: this.adapter.siteId,
                enabled,
                conversationKey: this.currentConversationKey,
                initialBacklogPending: this.initialBacklogPending,
                isProcessingInitialBacklog: this.isProcessingInitialBacklog,
            }, 'info');
            this.updatePmToggleUi();

            if (!enabled) {
                this.pendingByAuthor.clear();
                if (this.pendingTimer) {
                    clearTimeout(this.pendingTimer);
                    this.pendingTimer = null;
                }

                const messageList = this.currentMessageList || this.adapter.getMessageList();
                if (messageList) {
                    removeBacklogProgress(messageList);
                }

                this.adapter.getMessageElements().forEach(element => {
                    if (element.dataset.qtsProcessed !== '1') {
                        delete element.dataset.qtsQueued;
                        resetRenderedTranslation(element.querySelector('[data-testid="chat-message-text"]'));
                    }
                });

                this.applyTranslationVisibilityToCurrentChat();
                return;
            }

            this.initialBacklogPending = true;
            telemetry.capture('controller.handleTranslationToggleChange.requeueBacklog', {
                siteId: this.adapter.siteId,
                conversationKey: this.currentConversationKey,
            }, 'info');
            this.applyTranslationVisibilityToCurrentChat();
            this.ensureInitialBacklogProcessed('toggle-enabled').catch(error => console.error('[qtranslate-script] backlog failed', error));
            this.queueNewMessages().catch(error => console.error('[qtranslate-script] queue failed', error));
        }

        retranslateCurrentChat() {
            const messageList = this.currentMessageList || this.adapter.getMessageList();
            if (!messageList) return;

            this.pendingByAuthor.clear();
            if (this.pendingTimer) {
                clearTimeout(this.pendingTimer);
                this.pendingTimer = null;
            }

            this.adapter.getMessageElements().forEach(element => {
                delete element.dataset.qtsProcessed;
                delete element.dataset.qtsSkipped;
                delete element.dataset.qtsQueued;
                resetRenderedTranslation(element.querySelector('[data-testid="chat-message-text"]'));
            });

            this.initialBacklogPending = true;
            this.ensureInitialBacklogProcessed('target-language-change').catch(error => console.error('[qtranslate-script] backlog failed', error));
        }

        applyTranslationVisibilityToCurrentChat() {
            const messageList = this.currentMessageList || this.adapter.getMessageList();
            if (!messageList) return;
            const enabled = isTranslationEnabled(this.state);
            messageList.querySelectorAll('[data-testid="chat-message-text"][data-qts-translated-text]').forEach(textNode => {
                setMessageTranslationState(textNode, enabled);
            });
        }

        getActiveConversationKey() {
            return this.currentConversationKey || this.adapter.getConversationIdentity();
        }

        buildOutgoingMessageKeyForMessage(message) {
            return buildOutgoingMessageKey(this.getActiveConversationKey(), message?.timestamp);
        }

        async storeOutgoingTranslationRecord(messageKey, record) {
            if (!messageKey || !record) return;

            const normalizedRecord = {
                messageKey,
                conversationKey: record.conversationKey,
                timestamp: String(record.timestamp || ''),
                originalText: normalizeWhitespace(record.originalText),
                translatedText: normalizeWhitespace(record.translatedText),
                targetLanguage: record.targetLanguage,
                createdAt: Number(record.createdAt || Date.now()),
                expiresAt: Number(record.expiresAt || (Date.now() + OUTGOING_MESSAGE_TTL_MS)),
            };

            this.persistedOutgoingTranslationCache.set(messageKey, normalizedRecord);
            this.missingOutgoingTranslationKeys.delete(messageKey);
            telemetry.capture('controller.storeOutgoingTranslationRecord', {
                siteId: this.adapter.siteId,
                messageKey,
                record: normalizedRecord,
            }, 'info');
            await this.outgoingMessageStore.put(normalizedRecord);
            await this.outgoingMessageStore.putOutgoingMessageMeta({
                messageKey,
                siteId: this.adapter.siteId,
                conversationKey: normalizedRecord.conversationKey,
                timestamp: normalizedRecord.timestamp,
                originalText: normalizedRecord.originalText,
                translatedText: normalizedRecord.translatedText,
                language: normalizedRecord.targetLanguage,
                updatedAt: Date.now(),
            });
        }

        async getStoredOutgoingTranslation(messageKey) {
            if (!messageKey) return null;

            const cached = this.persistedOutgoingTranslationCache.get(messageKey);
            if (cached) {
                if (Number(cached.expiresAt || 0) > Date.now()) {
                    telemetry.capture('controller.getStoredOutgoingTranslation.cacheHit', {
                        siteId: this.adapter.siteId,
                        messageKey,
                        record: cached,
                    });
                    return cached;
                }
                this.persistedOutgoingTranslationCache.delete(messageKey);
            }

            if (this.missingOutgoingTranslationKeys.has(messageKey)) {
                return null;
            }

            const stored = await this.outgoingMessageStore.get(messageKey);
            if (!stored) {
                this.missingOutgoingTranslationKeys.add(messageKey);
                telemetry.capture('controller.getStoredOutgoingTranslation.miss', {
                    siteId: this.adapter.siteId,
                    messageKey,
                }, 'warn');
                return null;
            }

            if (Number(stored.expiresAt || 0) <= Date.now()) {
                this.persistedOutgoingTranslationCache.delete(messageKey);
                this.missingOutgoingTranslationKeys.add(messageKey);
                this.outgoingMessageStore.delete(messageKey).catch(() => {});
                return null;
            }

            this.persistedOutgoingTranslationCache.set(messageKey, stored);
            this.missingOutgoingTranslationKeys.delete(messageKey);
            telemetry.capture('controller.getStoredOutgoingTranslation.storeHit', {
                siteId: this.adapter.siteId,
                messageKey,
                record: stored,
            });
            return stored;
        }

        async findStoredOutgoingTranslationFallback(message) {
            if (!message || !message.timestamp) return null;

            const conversationKey = this.getActiveConversationKey();
            const translatedText = normalizeWhitespace(message.text);
            if (!conversationKey || !translatedText) return null;

            const allRecords = await this.outgoingMessageStore.getAllOutgoingMessages();
            const now = Date.now();
            const messageTimestamp = Number(message.timestamp || 0);

            const candidates = allRecords
                .filter(record =>
                    record &&
                    Number(record.expiresAt || 0) > now &&
                    record.conversationKey === conversationKey &&
                    normalizeWhitespace(record.translatedText) === translatedText
                )
                .sort((a, b) => Math.abs(Number(a.timestamp || 0) - messageTimestamp) - Math.abs(Number(b.timestamp || 0) - messageTimestamp));

            return candidates[0] || null;
        }

        async resolveStoredOutgoingTranslation(message) {
            const messageKey = this.buildOutgoingMessageKeyForMessage(message);
            const exact = messageKey ? await this.getStoredOutgoingTranslation(messageKey) : null;
            if (exact) return exact;

            const fallback = await this.findStoredOutgoingTranslationFallback(message);
            if (!fallback || !messageKey) return fallback;

            const reboundRecord = {
                ...fallback,
                messageKey,
                timestamp: String(message.timestamp || fallback.timestamp || ''),
            };

            await this.storeOutgoingTranslationRecord(messageKey, reboundRecord);
            return reboundRecord;
        }

        async warmOutgoingTranslationsForMessages(messages) {
            const outgoingMessages = messages.filter(message => message?.direction === 'outgoing' && message.timestamp);
            if (!outgoingMessages.length) return;

            await Promise.all(outgoingMessages.map(message => this.resolveStoredOutgoingTranslation(message)));
        }

        async getVisibleMessagesPrepared(options = {}) {
            const parsedMessages = this.adapter.getMessageElements()
                .map(element => this.adapter.parseMessageElement(element))
                .filter(Boolean);

            await this.warmDetectedLanguages(parsedMessages.map(message => message.authorKey));
            await this.warmOutgoingTranslationsForMessages(parsedMessages);

            return parsedMessages
                .map(message => this.hydrateOutgoingMessage(message))
                .filter(Boolean)
                .filter(message => !this.shouldSkipMessage(message, options));
        }

        rememberOutgoingTranslation(originalText, translatedText, targetLanguage) {
            this.outgoingTranslationMemory.push({
                conversationKey: this.getActiveConversationKey(),
                originalText: normalizeWhitespace(originalText),
                translatedText: normalizeWhitespace(translatedText),
                targetLanguage,
                createdAt: Date.now(),
            });
            this.outgoingTranslationMemory = this.outgoingTranslationMemory
                .filter(item => Date.now() - item.createdAt < 5 * 60 * 1000)
                .slice(-40);
        }

        hydrateOutgoingMessage(message) {
            if (message.direction !== 'outgoing') return message;

            const messageKey = this.buildOutgoingMessageKeyForMessage(message);
            const persistedMatch = messageKey ? this.persistedOutgoingTranslationCache.get(messageKey) : null;
            if (persistedMatch) {
                message.text = persistedMatch.originalText;
                message.prefetchedTranslatedText = persistedMatch.translatedText;
                message.prefetchedDetectedLanguage = persistedMatch.targetLanguage;
                return message;
            }

            const currentText = normalizeWhitespace(message.text);
            const matchIndex = this.outgoingTranslationMemory.findIndex(item =>
                item.conversationKey === this.getActiveConversationKey() &&
                item.translatedText === currentText
            );
            if (matchIndex === -1) return message;

            const match = this.outgoingTranslationMemory.splice(matchIndex, 1)[0];
            message.text = match.originalText;
            message.prefetchedTranslatedText = match.translatedText;
            message.prefetchedDetectedLanguage = match.targetLanguage;

            if (messageKey) {
                this.storeOutgoingTranslationRecord(messageKey, {
                    conversationKey: this.getActiveConversationKey(),
                    timestamp: message.timestamp,
                    originalText: match.originalText,
                    translatedText: match.translatedText,
                    targetLanguage: match.targetLanguage,
                    createdAt: Date.now(),
                    expiresAt: Date.now() + OUTGOING_MESSAGE_TTL_MS,
                }).catch(() => {});
            }

            return message;
        }

        async handleComposerKeyDown(event) {
            if (!CONFIG.translateOutgoingComposer) return;
            if (event.key !== 'Enter') return;
            if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
            if (event.isComposing) return;

            event.preventDefault();
            event.stopPropagation();
            await this.translateComposerAndSend();
        }

        async handleSendButtonClick(event) {
            if (!CONFIG.translateOutgoingComposer) return;

            if (this.allowNativeSendClick) {
                this.allowNativeSendClick = false;
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            await this.translateComposerAndSend();
        }

        async translateComposerAndSend() {
            if (this.isSendingTranslatedMessage) {
                telemetry.capture('controller.translateComposerAndSend.reentrantBlocked', {
                    siteId: this.adapter.siteId,
                }, 'warn');
                return;
            }

            const inputNode = this.adapter.getComposerInput();
            const sendButton = this.adapter.getSendButton();
            if (!inputNode || !sendButton) {
                telemetry.capture('controller.translateComposerAndSend.missingComposerPieces', {
                    siteId: this.adapter.siteId,
                    hasInputNode: Boolean(inputNode),
                    hasSendButton: Boolean(sendButton),
                    domSnapshot: this.captureDomSnapshot('translate-composer-and-send-missing-pieces', this.adapter.getConversationRoot() || document.body, {
                        includeParent: false,
                    }),
                }, 'warn');
                return;
            }

            if (!isOutgoingTranslationEnabled(this.state)) {
                telemetry.capture('controller.translateComposerAndSend.nativeSend', {
                    siteId: this.adapter.siteId,
                    reason: 'outgoing-translation-disabled',
                }, 'info');
                this.allowNativeSendClick = true;
                sendButton.click();
                return;
            }

            const originalText = getComposerText(inputNode);
            if (!originalText) {
                telemetry.capture('controller.translateComposerAndSend.emptyComposer', {
                    siteId: this.adapter.siteId,
                }, 'warn');
                return;
            }

            this.isSendingTranslatedMessage = true;
            telemetry.capture('controller.translateComposerAndSend.start', {
                siteId: this.adapter.siteId,
                conversationKey: this.getActiveConversationKey(),
                originalText,
            }, 'info');
            clearComposerStatus(inputNode);
            renderComposerInfo(inputNode, 'preparing to send...');
            setComposerBusyState(inputNode, sendButton, true);

            try {
                const outgoingTargetLanguage = getConfiguredOutgoingTargetLanguage(this.state);
                const translated = await this.translator.translateText(
                    originalText,
                    CONFIG.sourceLanguage,
                    outgoingTargetLanguage
                );

                const translatedText = normalizeWhitespace(translated.translatedText || '');
                if (!translatedText) {
                    throw new Error('Empty outgoing translation');
                }

                this.rememberOutgoingTranslation(originalText, translatedText, outgoingTargetLanguage);
                setComposerText(inputNode, translatedText);
                await waitForComposerText(inputNode, translatedText, 600);
                await sleep(80);
                this.allowNativeSendClick = true;
                sendButton.click();
                await waitForComposerSendSettlement(inputNode);
                clearComposerStatus(inputNode);
                telemetry.capture('controller.translateComposerAndSend.success', {
                    siteId: this.adapter.siteId,
                    conversationKey: this.getActiveConversationKey(),
                    originalText,
                    translatedText,
                    outgoingTargetLanguage,
                    detectedLanguage: translated.detectedLanguage,
                }, 'info');
            } catch (error) {
                renderComposerError(inputNode, error);
                log('Outgoing composer translation failed after retries', error);
                telemetry.capture('controller.translateComposerAndSend.failed', {
                    siteId: this.adapter.siteId,
                    conversationKey: this.getActiveConversationKey(),
                    originalText,
                    error,
                    domSnapshot: this.captureDomSnapshot('translate-composer-and-send-failed', inputNode || this.adapter.getConversationRoot() || document.body, {
                        includeParent: true,
                        extra: {
                            hasSendButton: Boolean(sendButton),
                        },
                    }),
                }, 'error');
            } finally {
                setComposerBusyState(inputNode, sendButton, false);
                this.isSendingTranslatedMessage = false;
            }
        }

        observeMessageList(messageList) {
            if (this.messageObserver) {
                this.messageObserver.disconnect();
            }
            this.messageObserver = new MutationObserver(() => {
                telemetry.capture('controller.observeMessageList.mutation', {
                    siteId: this.adapter.siteId,
                    conversationKey: this.currentConversationKey,
                });
                if (this.messageQueueTimer) clearTimeout(this.messageQueueTimer);
                this.messageQueueTimer = setTimeout(() => {
                    this.queueNewMessages().catch(error => console.error('[qtranslate-script] queue failed', error));
                }, CONFIG.observerSettleMs);
            });
            this.messageObserver.observe(messageList, {
                childList: true,
                subtree: true,
            });
        }

        getUserProfile(authorKey) {
            const siteState = getSiteState(this.state, this.adapter.siteId);
            siteState.users[authorKey] ??= {
                detectedLanguage: null,
                updatedAt: 0,
            };
            return siteState.users[authorKey];
        }

        updateUserLanguage(authorKey, detectedLanguage) {
            if (!detectedLanguage) return;
            const profile = this.getUserProfile(authorKey);
            profile.detectedLanguage = detectedLanguage;
            profile.updatedAt = Date.now();
            const profileKey = buildDetectedLanguageKey(this.adapter.siteId, authorKey);
            if (profileKey) {
                const record = {
                    profileKey,
                    siteId: this.adapter.siteId,
                    authorKey,
                    detectedLanguage,
                    updatedAt: profile.updatedAt,
                };
                this.detectedLanguageCache.set(profileKey, record);
                this.outgoingMessageStore.putDetectedLanguage(record).catch(() => {});
            }
            telemetry.capture('controller.updateUserLanguage', {
                siteId: this.adapter.siteId,
                authorKey,
                detectedLanguage,
                profileKey,
            }, 'info');
            saveState(this.state);
        }

        isIncomingTranslationActive() {
            return this.adapter.supportsIncomingTranslation() && isTranslationEnabled(this.state);
        }

        isVisibleTranslationProcessingActive() {
            return this.isIncomingTranslationActive() || isOutgoingTranslationEnabled(this.state);
        }

        shouldRenderTranslationForMessage(message) {
            if (!message) return false;
            if (message.direction === 'incoming') {
                return this.isIncomingTranslationActive();
            }
            if (message.direction === 'outgoing') {
                return CONFIG.translateOwnMessages && isOutgoingTranslationEnabled(this.state);
            }
            return false;
        }

        shouldSkipMessage(message, options = {}) {
            const { allowQueued = false } = options;

            if (message.root.dataset.qtsProcessed === '1') return true;
            if (message.root.dataset.qtsSkipped === '1') return true;
            if (message.direction === 'incoming' && !this.isIncomingTranslationActive()) return true;
            if (message.direction === 'outgoing' && !CONFIG.translateOwnMessages) return true;
            if (message.root.dataset.qtsQueued === '1' && !allowQueued) return true;

            if (message.direction === 'outgoing' && !message.prefetchedTranslatedText) {
                message.root.dataset.qtsSkipped = '1';
                markSkipped(message);
                return true;
            }

            const profile = this.getUserProfile(message.authorKey);
            const effectiveTargetLanguage = getEffectiveTargetLanguage(this.state);
            if (
                CONFIG.skipMessagesAlreadyInTargetLanguage &&
                profile.detectedLanguage &&
                profile.detectedLanguage.toLowerCase() === effectiveTargetLanguage.toLowerCase()
            ) {
                message.root.dataset.qtsSkipped = '1';
                markSkipped(message);
                return true;
            }

            return false;
        }

        groupBacklogMessages(messages) {
            const groups = [];
            let current = [];
            let currentAuthor = null;

            for (const message of messages) {
                if (current.length === 0) {
                    current.push(message);
                    currentAuthor = message.authorKey;
                    continue;
                }

                if (message.authorKey !== currentAuthor) {
                    groups.push(current);
                    current = [message];
                    currentAuthor = message.authorKey;
                    continue;
                }

                current.push(message);
            }

            if (current.length) groups.push(current);
            return groups;
        }

        getVisibleMessages(options = {}) {
            const { allowQueued = false } = options;
            return this.adapter.getMessageElements()
                .map(element => this.adapter.parseMessageElement(element))
                .map(message => message ? this.hydrateOutgoingMessage(message) : null)
                .filter(Boolean)
                .filter(message => !this.shouldSkipMessage(message, { allowQueued }));
        }

        async ensureInitialBacklogProcessed(trigger) {
            if (!this.initialBacklogPending || this.isProcessingInitialBacklog) {
                telemetry.capture('controller.ensureInitialBacklogProcessed.skipped', {
                    siteId: this.adapter.siteId,
                    trigger,
                    initialBacklogPending: this.initialBacklogPending,
                    isProcessingInitialBacklog: this.isProcessingInitialBacklog,
                });
                return false;
            }

            const messageList = this.adapter.getMessageList();
            if (!this.isIncomingTranslationActive()) {
                removeBacklogProgress(messageList);
                telemetry.capture('controller.ensureInitialBacklogProcessed.incomingInactive', {
                    siteId: this.adapter.siteId,
                    trigger,
                }, 'warn');
                return false;
            }

            const parsedMessages = await this.getVisibleMessagesPrepared();

            if (!messageList || !parsedMessages.length) {
                return false;
            }

            this.isProcessingInitialBacklog = true;
            this.initialBacklogPending = false;
            telemetry.capture('controller.ensureInitialBacklogProcessed.start', {
                siteId: this.adapter.siteId,
                trigger,
                parsedMessageCount: parsedMessages.length,
            }, 'info');

            try {
                await this.processVisibleBacklog(messageList, parsedMessages);
                return true;
            } catch (error) {
                this.initialBacklogPending = true;
                throw error;
            } finally {
                this.isProcessingInitialBacklog = false;
            }
        }

        async processVisibleBacklog(messageList = this.adapter.getMessageList(), parsedMessages = this.getVisibleMessages()) {
            if (!this.isIncomingTranslationActive()) {
                removeBacklogProgress(messageList);
                return;
            }

            if (!parsedMessages.length) return;

            log('Processing visible backlog', parsedMessages.length);
            telemetry.capture('controller.processVisibleBacklog.start', {
                siteId: this.adapter.siteId,
                parsedMessageCount: parsedMessages.length,
            }, 'info');

            const groups = this.groupBacklogMessages(parsedMessages);
            const targetLanguage = getEffectiveTargetLanguage(this.state);
            updateBacklogProgress(messageList, 0, groups.length);

            try {
                for (let index = 0; index < groups.length; index += 1) {
                    const group = groups[index];
                    try {
                        const prefetched = group.filter(message => message.prefetchedTranslatedText);
                        const toTranslate = group.filter(message => !message.prefetchedTranslatedText);

                        group.forEach(message => {
                            message.root.dataset.qtsQueued = '1';
                            createPendingTranslationNode(message);
                        });

                        if (prefetched.length) {
                            this.applyTranslations(prefetched.map(message => ({
                                ...message,
                                translatedText: message.prefetchedTranslatedText,
                                detectedLanguage: message.prefetchedDetectedLanguage || getConfiguredOutgoingTargetLanguage(this.state),
                            })));
                        }

                        if (toTranslate.length) {
                            try {
                                const translated = await this.translator.translateBatch(toTranslate, {
                                    maxMessages: CONFIG.initialBatchMessageLimit,
                                    maxChars: CONFIG.initialBatchCharLimit,
                                }, targetLanguage);
                                this.applyTranslations(translated);
                            } catch (error) {
                                toTranslate.forEach(message => {
                                    delete message.root.dataset.qtsQueued;
                                    renderTranslationError(message, error);
                                });
                                log('Backlog translation failed after retries', error);
                            }
                        }
                    } finally {
                        updateBacklogProgress(messageList, index + 1, groups.length);
                    }
                }
            } finally {
                removeBacklogProgressWhenReady(messageList).catch(() => {});
            }
        }

        async queueNewMessages() {
            if (!this.isVisibleTranslationProcessingActive()) {
                telemetry.capture('controller.queueNewMessages.skippedInactive', {
                    siteId: this.adapter.siteId,
                });
                return;
            }

            if (await this.ensureInitialBacklogProcessed('observer')) {
                return;
            }

            const messages = await this.getVisibleMessagesPrepared();

            if (!messages.length) {
                telemetry.capture('controller.queueNewMessages.noMessages', {
                    siteId: this.adapter.siteId,
                    conversationKey: this.currentConversationKey,
                });
                return;
            }

            for (const message of messages) {
                const bucket = this.pendingByAuthor.get(message.authorKey) || [];
                if (bucket.some(existing => existing.id === message.id)) continue;
                bucket.push(message);
                this.pendingByAuthor.set(message.authorKey, bucket);
                message.root.dataset.qtsQueued = '1';
                createPendingTranslationNode(message);
            }

            if (this.pendingTimer) clearTimeout(this.pendingTimer);
            telemetry.capture('controller.queueNewMessages.queued', {
                siteId: this.adapter.siteId,
                conversationKey: this.currentConversationKey,
                pendingAuthorCount: this.pendingByAuthor.size,
                queuedMessageCount: messages.length,
            }, 'info');
            this.pendingTimer = setTimeout(() => {
                this.flushPending().catch(error => console.error('[qtranslate-script] flush failed', error));
            }, CONFIG.newMessageDebounceMs);
        }

        async flushPending() {
            const entries = [...this.pendingByAuthor.entries()];
            this.pendingByAuthor.clear();
            this.pendingTimer = null;
            telemetry.capture('controller.flushPending.start', {
                siteId: this.adapter.siteId,
                batchCount: entries.length,
            }, 'info');

            for (const [, messages] of entries) {
                const filtered = messages.filter(message => !this.shouldSkipMessage(message, { allowQueued: true }));

                if (!filtered.length) continue;
                log('Processing incremental batch', filtered.length, filtered[0].authorName);

                const prefetched = filtered.filter(message => message.prefetchedTranslatedText);
                const toTranslate = filtered.filter(message => !message.prefetchedTranslatedText);

                if (prefetched.length) {
                    this.applyTranslations(prefetched.map(message => ({
                        ...message,
                        translatedText: message.prefetchedTranslatedText,
                        detectedLanguage: message.prefetchedDetectedLanguage || getConfiguredOutgoingTargetLanguage(this.state),
                    })));
                }

                if (toTranslate.length) {
                    try {
                        const targetLanguage = getEffectiveTargetLanguage(this.state);
                        const translated = await this.translator.translateBatch(toTranslate, {
                            maxMessages: CONFIG.newMessageBatchMessageLimit,
                            maxChars: CONFIG.newMessageBatchCharLimit,
                        }, targetLanguage);
                        this.applyTranslations(translated);
                    } catch (error) {
                        toTranslate.forEach(message => {
                            delete message.root.dataset.qtsQueued;
                            renderTranslationError(message, error);
                        });
                        log('Incremental translation failed after retries', error);
                    }
                }
            }
        }

        applyTranslations(messages) {
            if (!this.isVisibleTranslationProcessingActive()) {
                telemetry.capture('controller.applyTranslations.skippedInactive', {
                    siteId: this.adapter.siteId,
                    messageCount: messages.length,
                }, 'warn');
                for (const message of messages) {
                    if (!message.root?.isConnected) continue;
                    delete message.root.dataset.qtsQueued;
                    if (message.root.dataset.qtsProcessed !== '1') {
                        resetRenderedTranslation(message.textNode);
                    }
                }
                return;
            }

            const effectiveTargetLanguage = getEffectiveTargetLanguage(this.state);
            telemetry.capture('controller.applyTranslations.start', {
                siteId: this.adapter.siteId,
                messageCount: messages.length,
                effectiveTargetLanguage,
            }, 'info');
            for (const message of messages) {
                if (!message.root?.isConnected) continue;
                if (!this.shouldRenderTranslationForMessage(message)) {
                    delete message.root.dataset.qtsQueued;
                    if (message.root.dataset.qtsProcessed !== '1') {
                        resetRenderedTranslation(message.textNode);
                    }
                    continue;
                }

                if (
                    CONFIG.skipMessagesAlreadyInTargetLanguage &&
                    message.detectedLanguage &&
                    message.detectedLanguage.toLowerCase() === effectiveTargetLanguage.toLowerCase()
                ) {
                    message.root.dataset.qtsSkipped = '1';
                    delete message.root.dataset.qtsQueued;
                    markSkipped(message);
                    this.updateUserLanguage(message.authorKey, message.detectedLanguage);
                    continue;
                }

                message.stateRef = this.state;
                renderTranslation(message, message.translatedText, message.detectedLanguage);
                delete message.root.dataset.qtsQueued;
                message.root.dataset.qtsProcessed = '1';
                this.updateUserLanguage(message.authorKey, message.detectedLanguage);
            }
        }
    }

    /**
     * Función de inicialización principal (Bootstrap).
     * Selecciona el adaptador de sitio correcto basado en la URL, inicializa el almacenamiento,
     * la API de traducción, el controlador central y arranca el ciclo de vida del script.
     */
    function bootstrap() {
        telemetry.start();
        telemetry.capture('bootstrap.start', {
            href: location.href,
            hostname: location.hostname,
        }, 'info');
        const adapters = [
            new ChaturbatePmAdapter(),
            new StripchatPmAdapter(),
        ];

        const adapter = adapters.find(candidate => candidate.isSupported());
        if (!adapter) {
            telemetry.capture('bootstrap.noAdapterMatched', {
                hostname: location.hostname,
            }, 'warn');
            log('No supported site adapter matched current page');
            return;
        }

        telemetry.capture('bootstrap.adapterMatched', {
            siteId: adapter.siteId,
            hostname: location.hostname,
        }, 'info');
        log('Bootstrapping adapter', adapter.siteId);
        const store = new OutgoingMessageStore();
        const translator = new GoogleTranslator(store);
        const controller = new TranslationController(adapter, translator, store);
        controller.start();
    }

    bootstrap();
})();
