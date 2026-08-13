/**
 * Character Sync - SillyTavern Extension
 * 切换角色时自动同步 UI 主题、聊天背景和 API 连接配置。
 *
 * 背景切换：导入原生 backgrounds.js 模块，通过 getBackgrounds() 获取列表，
 *           通过 chat_metadata['custom_background'] + saveMetadata + 直接设置 #bg1 切换。
 * API 切换：通过 Connection Manager 的 selectedProfile 切换连接配置，
 *           或回退到 /profile 斜杠命令。
 */

const MODULE_NAME = 'character_sync';
const DISPLAY_NAME = 'Character Sync';

// ============================================================
// 工具
// ============================================================
function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================================
// 设置
// ============================================================
const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    switchTheme: true,
    switchBackground: true,
    switchApi: true,
    bindings: {},  // { "avatar_filename": { theme, background, api } }
});

function getSettings() {
    const ctx = SillyTavern.getContext();
    if (!ctx.extensionSettings[MODULE_NAME]) {
        ctx.extensionSettings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
    }
    const s = ctx.extensionSettings[MODULE_NAME];
    // 向后兼容：旧版的 switchPreset / preset 迁移到 switchApi / api
    if (s.switchApi === undefined && s.switchPreset !== undefined) {
        s.switchApi = s.switchPreset;
    }
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (!Object.hasOwn(s, key)) s[key] = structuredClone(DEFAULT_SETTINGS[key]);
    }
    if (!s.bindings || typeof s.bindings !== 'object') s.bindings = {};
    // 迁移旧的 preset 绑定键到 api
    for (const [k, v] of Object.entries(s.bindings)) {
        if (v.preset && !v.api) {
            v.api = v.preset;
            delete v.preset;
        }
    }
    return s;
}

function saveSettings() {
    SillyTavern.getContext().saveSettingsDebounced();
}

// ============================================================
// 角色键（avatar 文件名）
// ============================================================
function getCurrentBot() {
    let ctx;
    try { ctx = SillyTavern.getContext(); } catch (_) { return null; }
    if (!ctx) return null;
    if (ctx.groupId) {
        const group = Array.isArray(ctx.groups)
            ? ctx.groups.find(g => String(g.id) === String(ctx.groupId))
            : null;
        return { key: `group:${ctx.groupId}`, label: group?.name || 'Group' };
    }
    if (ctx.characterId === undefined || ctx.characterId === null || ctx.characterId < 0) return null;
    const char = ctx.characters?.[ctx.characterId];
    if (!char) return null;
    return { key: char.avatar || char.name, label: char.name };
}

// ============================================================
// 主题切换
// ============================================================
function applyThemeByName(name) {
    if (!name) return false;
    const themesSelect = document.getElementById('themes');
    if (!themesSelect) {
        console.warn(`[${DISPLAY_NAME}] #themes not found`);
        return false;
    }
    const hasOption = Array.from(themesSelect.options).some(o => o.value === name);
    if (!hasOption) {
        console.warn(`[${DISPLAY_NAME}] Theme "${name}" not found`);
        return false;
    }
    if (themesSelect.value === name) return true;

    if ($(themesSelect).hasClass('select2-hidden-accessible')) {
        $(themesSelect).val(name).trigger('change');
    } else {
        themesSelect.value = name;
        themesSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    console.log(`[${DISPLAY_NAME}] Theme → "${name}"`);
    return true;
}

// ============================================================
// 背景切换
// 参考 Background Manager 实现：
//   - 列表: POST /api/backgrounds/all → 获取文件名
//   - 切换: chat_metadata['custom_background'] = cssUrl → saveMetadata → #bg1 CSS
// 多重 fallback 确保兼容性
// ============================================================
function getBackgroundCssUrl(file) {
    if (!file) return '';
    return `url("backgrounds/${encodeURIComponent(file)}")`;
}

function setVisibleBackground(cssUrl) {
    const el = document.getElementById('bg1');
    if (el) el.style.backgroundImage = cssUrl;
    console.log(`[${DISPLAY_NAME}] #bg1.style.backgroundImage = ${cssUrl ? cssUrl.substring(0, 80) + '...' : '(cleared)'}`);
}

async function applyBackgroundByName(bgName) {
    if (!bgName) return false;
    const ctx = SillyTavern.getContext();
    try {
        // 1. 获取完整背景列表以找到完整文件名
        const resp = await fetch('/api/backgrounds/all', {
            method: 'POST',
            headers: ctx.getRequestHeaders(),
        });
        if (!resp.ok) {
            console.warn(`[${DISPLAY_NAME}] Background API returned ${resp.status}`);
            // 尝试作为文件名直接使用
            return applyBackgroundFallback(bgName, ctx);
        }
        const data = await resp.json();
        // API 返回: { images: [{ filename, isAnimated }, ...], config: { width, height } }
        const backgrounds = data.images || data.backgrounds || [];
        console.log(`[${DISPLAY_NAME}] Background API returned ${backgrounds.length} items, looking for "${bgName}"`);

        const bg = backgrounds.find(b =>
            (b.filename || b.name || b.file || '') === bgName || b.url === bgName
        );
        if (!bg) {
            console.warn(`[${DISPLAY_NAME}] Background "${bgName}" not found in API list`);
            // 尝试作为文件名直接使用
            return applyBackgroundFallback(bgName, ctx);
        }

        const file = bg.filename || bg.file || bg.name;
        return applyBackgroundRaw(file, ctx);
    } catch (e) {
        console.error(`[${DISPLAY_NAME}] Background API error:`, e);
        return applyBackgroundFallback(bgName, ctx);
    }
}

function applyBackgroundFallback(bgName, ctx) {
    console.log(`[${DISPLAY_NAME}] Trying fallback: applying "${bgName}" directly`);
    return applyBackgroundRaw(bgName, ctx);
}

function applyBackgroundRaw(file, ctx) {
    if (!file) return false;
    const cssUrl = getBackgroundCssUrl(file);

    // 写入 chat_metadata（与 /lockbg 一致）
    if (ctx.chatMetadata) {
        ctx.chatMetadata['custom_background'] = cssUrl;
        if (typeof ctx.saveMetadata === 'function') {
            ctx.saveMetadata();
        }
    }

    // 直接设置可见背景
    setVisibleBackground(cssUrl);

    console.log(`[${DISPLAY_NAME}] Background → "${file}"`);
    return true;
}

// ============================================================
// API 连接切换
// 通过 SlashCommandParser 调用 /profile 命令（Connection Manager 原生机制），
// 回退到 DOM 操作 #connection_profiles 下拉框。
// ============================================================
async function applyApiByName(apiName) {
    if (!apiName) return false;
    const ctx = SillyTavern.getContext();

    // 方法1: 通过 SlashCommandParser 调用 /profile 命令（推荐方式）
    // 这是 Connection Manager 扩展提供的原生切换入口，会完整执行
    // applyConnectionProfile → 逐一设置 api/model/preset/api-url 等
    try {
        const SlashCommandParser = window.SlashCommandParser
            || (await import('/scripts/slash-commands/SlashCommandParser.js')).default
            || (await import('/scripts/slash-commands/SlashCommandParser.js')).SlashCommandParser;
        const cmd = SlashCommandParser.commands?.['profile'];
        if (cmd && typeof cmd.callback === 'function') {
            console.log(`[${DISPLAY_NAME}] Switching API via /profile "${apiName}" with await=true`);
            await cmd.callback({ await: 'true' }, apiName);
            console.log(`[${DISPLAY_NAME}] API → "${apiName}" (via /profile command)`);
            return true;
        }
    } catch (e) {
        console.warn(`[${DISPLAY_NAME}] SlashCommandParser /profile failed:`, e.message);
    }

    // 方法2: 通过 DOM 操作 #connection_profiles 下拉框触发 change 事件
    try {
        const profilesSelect = document.getElementById('connection_profiles');
        if (profilesSelect) {
            const options = Array.from(profilesSelect.options);
            const idx = options.findIndex(o => o.value === apiName || o.textContent?.trim() === apiName);
            if (idx >= 0) {
                profilesSelect.selectedIndex = idx;
                profilesSelect.dispatchEvent(new Event('change', { bubbles: true }));
                console.log(`[${DISPLAY_NAME}] API → "${apiName}" (via #connection_profiles DOM)`);
                return true;
            }
        }
    } catch (e) {
        console.warn(`[${DISPLAY_NAME}] DOM profile switch failed:`, e.message);
    }

    // 方法3: 尝试通过 executeSlashCommandsWithOptions
    if (typeof ctx.executeSlashCommandsWithOptions === 'function') {
        try {
            console.log(`[${DISPLAY_NAME}] Trying executeSlashCommandsWithOptions /profile "${apiName}"`);
            await ctx.executeSlashCommandsWithOptions(`/profile await=true ${apiName}`, { showOutput: false });
            console.log(`[${DISPLAY_NAME}] API → "${apiName}" (via executeSlashCommandsWithOptions)`);
            return true;
        } catch (e) {
            console.warn(`[${DISPLAY_NAME}] executeSlashCommandsWithOptions failed:`, e.message);
        }
    }

    console.warn(`[${DISPLAY_NAME}] API "${apiName}" not found or switch failed`);
    return false;
}

// ============================================================
// 主切换逻辑
// ============================================================
async function applyCharacterBindings() {
    const settings = getSettings();
    const bot = getCurrentBot();
    if (!bot) {
        console.log(`[${DISPLAY_NAME}] No current bot, skipping`);
        return;
    }

    const binding = settings.bindings[bot.key];

    // 扩展已禁用：清理该角色之前锁定的背景，避免原生 backgrounds.js 在
    // onChatChanged 时从 chat_metadata['custom_background'] 恢复旧背景
    if (!settings.enabled) {
        if (binding?.background) {
            clearBackgroundLock();
        }
        console.log(`[${DISPLAY_NAME}] Disabled, skipping`);
        return;
    }

    if (!binding) {
        // 无绑定，但也需要清理该角色之前可能锁定的背景
        // （如果 switchBackground 关闭，之前锁定的背景不应该被恢复）
        if (!settings.switchBackground) {
            clearBackgroundLock();
        }
        console.log(`[${DISPLAY_NAME}] No binding for "${bot.label}" (key: ${bot.key})`);
        return;
    }

    console.log(`[${DISPLAY_NAME}] Applying bindings for "${bot.label}":`, binding);

    if (settings.switchTheme && binding.theme) {
        applyThemeByName(binding.theme);
    }

    if (settings.switchBackground && binding.background) {
        await applyBackgroundByName(binding.background);
    } else if (binding.background) {
        // 背景切换开关关闭，但该角色有绑定背景 → 清理 lock 防止原生代码恢复
        clearBackgroundLock();
    }

    if (settings.switchApi && binding.api) {
        await applyApiByName(binding.api);
    }
}

function clearBackgroundLock() {
    const ctx = SillyTavern.getContext();
    if (ctx.chatMetadata && ctx.chatMetadata['custom_background']) {
        delete ctx.chatMetadata['custom_background'];
        if (typeof ctx.saveMetadata === 'function') {
            ctx.saveMetadata();
        }
        console.log(`[${DISPLAY_NAME}] Cleared background lock from chat_metadata`);
    }
    setVisibleBackground('');
}

// ============================================================
// 获取背景列表（用于 UI 下拉框）
// 多重来源：API → 原生模块 → DOM
// ============================================================
async function fetchBackgrounds() {
    const ctx = SillyTavern.getContext();

    // 方法1: POST /api/backgrounds/all
    try {
        const resp = await fetch('/api/backgrounds/all', {
            method: 'POST',
            headers: ctx.getRequestHeaders(),
        });
        if (resp.ok) {
            const data = await resp.json();
            // API 返回: { images: [{ filename, isAnimated }, ...], config: { width, height } }
            const bgList = data.images || data.backgrounds || [];
            const bgs = bgList
                .map(b => b.filename || b.name || b.file || '')
                .filter(Boolean);
            if (bgs.length > 0) {
                console.log(`[${DISPLAY_NAME}] ${bgs.length} backgrounds from API`);
                return bgs;
            }
        }
    } catch (e) {
        console.warn(`[${DISPLAY_NAME}] API backgrounds failed:`, e.message);
    }

    // 方法2: 尝试从 /backgrounds/ 目录列表获取（兜底方案）
    try {
        const resp = await fetch('/backgrounds/');
        if (resp.ok) {
            const html = await resp.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const links = doc.querySelectorAll('a');
            const imgExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.apng', '.mp4'];
            const bgs = Array.from(links)
                .map(a => (a.textContent || a.getAttribute('href') || '').trim())
                .filter(name => name && imgExts.some(ext => name.toLowerCase().endsWith(ext)))
                .map(decodeURIComponent);
            if (bgs.length > 0) {
                console.log(`[${DISPLAY_NAME}] ${bgs.length} backgrounds from directory listing`);
                return bgs;
            }
        }
    } catch (e) {
        console.warn(`[${DISPLAY_NAME}] Directory listing failed:`, e.message);
    }

    // 方法4: 导入原生 backgrounds.js 模块获取 getBackgrounds()
    try {
        const mod = await import('/scripts/backgrounds.js');
        if (mod && typeof mod.getBackgrounds === 'function') {
            const bgs = await mod.getBackgrounds();
            if (Array.isArray(bgs) && bgs.length > 0) {
                const names = bgs.map(b => (typeof b === 'string' ? b : b.name || b.file || '')).filter(Boolean);
                if (names.length > 0) {
                    console.log(`[${DISPLAY_NAME}] ${names.length} backgrounds from native module`);
                    return names;
                }
            }
        }
    } catch (e) {
        console.warn(`[${DISPLAY_NAME}] Native module backgrounds failed:`, e.message);
    }

    // 方法5: 从 DOM 中查找背景列表
    const selectors = [
        '#backgrounds_list [data-bg-name]',
        '#bg_list [data-bg-name]',
        '#backgrounds_list option',
        '#bg_list option',
        '.bg-item[data-name]',
        '.bg-thumb[data-name]',
    ];
    for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
            const names = Array.from(els)
                .map(el => el.getAttribute('data-bg-name') || el.getAttribute('data-name') || el.value || el.textContent?.trim())
                .filter(Boolean);
            if (names.length > 0) {
                console.log(`[${DISPLAY_NAME}] ${names.length} backgrounds from DOM: "${sel}"`);
                return names;
            }
        }
    }

    console.warn(`[${DISPLAY_NAME}] No backgrounds found from any source`);
    return [];
}

// ============================================================
// 获取 API 连接配置列表（用于 UI 下拉框）
// 多重来源：Connection Manager → CONNECT_API_MAP → DOM
// ============================================================
function getApiOptions() {
    const ctx = SillyTavern.getContext();

    // 方法1: 从 Connection Manager 获取
    const cmSettings = ctx.extensionSettings?.connectionManager;
    if (cmSettings?.profiles && cmSettings.profiles.length > 0) {
        const names = cmSettings.profiles.map(p => p.name || p.id).filter(Boolean);
        console.log(`[${DISPLAY_NAME}] ${names.length} API profiles from Connection Manager`);
        return names;
    }

    // 方法2: 从 CONNECT_API_MAP 获取
    if (ctx.CONNECT_API_MAP) {
        const names = Object.keys(ctx.CONNECT_API_MAP).filter(Boolean);
        if (names.length > 0) {
            console.log(`[${DISPLAY_NAME}] ${names.length} APIs from CONNECT_API_MAP`);
            return names;
        }
    }

    // 方法3: 从 DOM #connection_profiles 下拉框获取
    const profilesSelect = document.getElementById('connection_profiles');
    if (profilesSelect) {
        const names = Array.from(profilesSelect.options)
            .map(o => o.value || o.textContent?.trim())
            .filter(Boolean);
        if (names.length > 0) {
            console.log(`[${DISPLAY_NAME}] ${names.length} API profiles from DOM`);
            return names;
        }
    }

    console.log(`[${DISPLAY_NAME}] No API profiles found`);
    return [];
}

// ============================================================
// 设置面板（inline-drawer 折叠面板）
// ============================================================
function buildSettingsHtml(themeOptions, bgOptions, apiOptions) {
    const settings = getSettings();
    const ctx = SillyTavern.getContext();
    const characters = ctx.characters || [];

    const charRows = characters.map((char) => {
        const charKey = char.avatar || char.name;
        const binding = settings.bindings[charKey] || {};
        const themeVal = binding.theme || '';
        const bgVal = binding.background || '';
        const apiVal = binding.api || '';
        const hasBinding = !!(themeVal || bgVal || apiVal);

        return `
        <tr class="csync-char-row ${hasBinding ? 'csync-has-binding' : ''}" data-char-key="${escapeHtml(charKey)}">
            <td class="csync-char-name">
                <span class="csync-binding-dot" style="display:${hasBinding ? 'inline-block' : 'none'}"></span>
                ${escapeHtml(char.name)}
            </td>
            <td>
                <select class="csync-theme-select" data-char-key="${escapeHtml(charKey)}">
                    <option value="">-- 不切换 --</option>
                    ${themeOptions.map(t => `<option value="${escapeHtml(t)}" ${t === themeVal ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
                </select>
            </td>
            <td>
                <select class="csync-bg-select" data-char-key="${escapeHtml(charKey)}">
                    <option value="">-- 不切换 --</option>
                    ${bgOptions.map(b => `<option value="${escapeHtml(b)}" ${b === bgVal ? 'selected' : ''}>${escapeHtml(b)}</option>`).join('')}
                </select>
            </td>
            <td>
                <select class="csync-api-select" data-char-key="${escapeHtml(charKey)}">
                    <option value="">-- 不切换 --</option>
                    ${apiOptions.map(a => `<option value="${escapeHtml(a)}" ${a === apiVal ? 'selected' : ''}>${escapeHtml(a)}</option>`).join('')}
                </select>
            </td>
            <td>
                <button class="csync-clear-btn" data-char-key="${escapeHtml(charKey)}" ${hasBinding ? '' : 'disabled'}>清除</button>
            </td>
        </tr>`;
    }).join('');

    return `
    <div id="csync-settings" class="csync-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>${DISPLAY_NAME}</b>
                <span class="csync-binding-count" id="csync-binding-count"></span>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="csync-desc">切换角色时自动同步主题、背景和 API 连接。</div>

                <div class="csync-global-toggles">
                    <label class="csync-toggle">
                        <input type="checkbox" id="csync-enabled" ${settings.enabled ? 'checked' : ''}>
                        <span>启用自动切换</span>
                    </label>
                    <label class="csync-toggle">
                        <input type="checkbox" id="csync-switch-theme" ${settings.switchTheme ? 'checked' : ''}>
                        <span>切换主题</span>
                    </label>
                    <label class="csync-toggle">
                        <input type="checkbox" id="csync-switch-bg" ${settings.switchBackground ? 'checked' : ''}>
                        <span>切换背景</span>
                    </label>
                    <label class="csync-toggle">
                        <input type="checkbox" id="csync-switch-api" ${settings.switchApi ? 'checked' : ''}>
                        <span>切换 API</span>
                    </label>
                </div>

                <div class="csync-actions">
                    <button id="csync-refresh-btn" class="csync-btn">刷新列表</button>
                    <button id="csync-clear-all-btn" class="csync-btn csync-btn-danger">清除所有绑定</button>
                </div>

                <div class="csync-table-wrapper">
                    <table class="csync-table">
                        <thead>
                            <tr>
                                <th>角色</th>
                                <th>主题</th>
                                <th>背景</th>
                                <th>API</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody id="csync-char-list">
                            ${charRows}
                        </tbody>
                    </table>
                    ${characters.length === 0 ? '<p class="csync-empty">暂无角色，请先创建角色卡片。</p>' : ''}
                </div>
            </div>
        </div>
    </div>`;
}

// ============================================================
// 事件绑定
// ============================================================
function bindSettingsEvents() {
    $('#csync-enabled').off('change').on('change', function () {
        getSettings().enabled = this.checked;
        saveSettings();
    });
    $('#csync-switch-theme').off('change').on('change', function () {
        getSettings().switchTheme = this.checked;
        saveSettings();
    });
    $('#csync-switch-bg').off('change').on('change', function () {
        getSettings().switchBackground = this.checked;
        saveSettings();
    });
    $('#csync-switch-api').off('change').on('change', function () {
        getSettings().switchApi = this.checked;
        saveSettings();
    });

    $('.csync-theme-select').off('change').on('change', function () {
        saveBinding($(this).data('char-key'), 'theme', this.value);
    });
    $('.csync-bg-select').off('change').on('change', function () {
        saveBinding($(this).data('char-key'), 'background', this.value);
    });
    $('.csync-api-select').off('change').on('change', function () {
        saveBinding($(this).data('char-key'), 'api', this.value);
    });
    $('.csync-clear-btn').off('click').on('click', function () {
        clearBinding($(this).data('char-key'));
    });
    $('#csync-refresh-btn').off('click').on('click', async function () {
        await refreshSettingsPanel();
    });
    $('#csync-clear-all-btn').off('click').on('click', function () {
        if (confirm('确定要清除所有角色的绑定吗？')) {
            clearAllBindings();
        }
    });

    updateBindingCount();
}

function saveBinding(charKey, field, value) {
    const settings = getSettings();
    if (!settings.bindings[charKey]) settings.bindings[charKey] = {};
    if (value) {
        settings.bindings[charKey][field] = value;
    } else {
        delete settings.bindings[charKey][field];
    }
    if (Object.keys(settings.bindings[charKey]).length === 0) {
        delete settings.bindings[charKey];
    }
    saveSettings();
    updateRowBindingState(charKey);
    updateBindingCount();
}

function clearBinding(charKey) {
    const settings = getSettings();
    delete settings.bindings[charKey];
    saveSettings();
    const row = document.querySelector(`.csync-char-row[data-char-key="${CSS.escape(charKey)}"]`);
    if (row) {
        row.querySelectorAll('select').forEach(s => s.value = '');
        row.classList.remove('csync-has-binding');
        const dot = row.querySelector('.csync-binding-dot');
        if (dot) dot.style.display = 'none';
        const btn = row.querySelector('.csync-clear-btn');
        if (btn) btn.disabled = true;
    }
    updateBindingCount();
}

function clearAllBindings() {
    getSettings().bindings = {};
    saveSettings();
    refreshSettingsPanel();
}

function updateRowBindingState(charKey) {
    const settings = getSettings();
    const binding = settings.bindings[charKey] || {};
    const hasBinding = !!(binding.theme || binding.background || binding.api);
    const row = document.querySelector(`.csync-char-row[data-char-key="${CSS.escape(charKey)}"]`);
    if (row) {
        row.classList.toggle('csync-has-binding', hasBinding);
        const dot = row.querySelector('.csync-binding-dot');
        if (dot) dot.style.display = hasBinding ? 'inline-block' : 'none';
        const btn = row.querySelector('.csync-clear-btn');
        if (btn) btn.disabled = !hasBinding;
    }
}

function updateBindingCount() {
    const count = Object.keys(getSettings().bindings).length;
    const el = document.getElementById('csync-binding-count');
    if (el) el.textContent = count > 0 ? `(${count} 个角色已绑定)` : '';
}

async function refreshSettingsPanel() {
    const themesSelect = document.getElementById('themes');
    const themeOptions = themesSelect
        ? Array.from(themesSelect.options).map(o => o.value).filter(Boolean)
        : [];
    const bgOptions = await fetchBackgrounds();
    const apiOptions = getApiOptions();

    const container = document.getElementById('csync-settings');
    if (!container) return;
    container.innerHTML = buildSettingsHtml(themeOptions, bgOptions, apiOptions);
    bindSettingsEvents();
}

// ============================================================
// 初始化
// ============================================================
function init() {
    console.log(`[${DISPLAY_NAME}] Initializing...`);
    tryMountPanel();

    const ctx = SillyTavern.getContext();
    if (ctx.eventSource && ctx.eventTypes) {
        const evt = ctx.eventTypes || ctx.event_types;
        const onChange = () => {
            console.log(`[${DISPLAY_NAME}] CHAT_CHANGED event received`);
            setTimeout(() => applyCharacterBindings(), 400);
        };
        if (evt.CHAT_CHANGED) {
            ctx.eventSource.on(evt.CHAT_CHANGED, onChange);
            console.log(`[${DISPLAY_NAME}] Listening for CHAT_CHANGED via eventSource`);
        }
        if (evt.APP_READY) {
            ctx.eventSource.on(evt.APP_READY, () => {
                setTimeout(() => tryMountPanel(), 500);
            });
        }
    } else {
        const eventTypes = ctx.event_types || ctx.eventTypes || {};
        const evtName = eventTypes.CHAT_CHANGED || 'CHAT_CHANGED';
        if (evtName) {
            $(document).on(evtName, () => {
                console.log(`[${DISPLAY_NAME}] ${evtName} event received (jQuery)`);
                setTimeout(() => applyCharacterBindings(), 400);
            });
            console.log(`[${DISPLAY_NAME}] Listening for ${evtName} via jQuery`);
        }
    }

    let retries = 0;
    const retryInterval = setInterval(() => {
        if (document.getElementById('csync-settings')) {
            clearInterval(retryInterval);
            return;
        }
        tryMountPanel();
        retries++;
        if (retries > 20) clearInterval(retryInterval);
    }, 1000);
}

async function tryMountPanel() {
    if (document.getElementById('csync-settings')) return;

    const target = document.getElementById('extensions_settings2');
    if (!target) return;

    const themesSelect = document.getElementById('themes');
    const themeOptions = themesSelect
        ? Array.from(themesSelect.options).map(o => o.value).filter(Boolean)
        : [];
    const bgOptions = await fetchBackgrounds();
    const apiOptions = getApiOptions();

    const container = document.createElement('div');
    container.id = 'csync-settings-container';
    container.innerHTML = buildSettingsHtml(themeOptions, bgOptions, apiOptions);
    target.appendChild(container);
    bindSettingsEvents();

    console.log(`[${DISPLAY_NAME}] Panel mounted — ${themeOptions.length} themes, ${bgOptions.length} backgrounds, ${apiOptions.length} APIs`);
}

// ============================================================
// 调试入口（控制台：window.csyncDebug()）
// ============================================================
window.csyncDebug = async function () {
    const ctx = SillyTavern.getContext();
    console.group(`[${DISPLAY_NAME}] Debug`);
    console.log('Settings:', JSON.parse(JSON.stringify(getSettings())));
    console.log('Current bot:', getCurrentBot());

    // 背景
    console.log('--- Backgrounds ---');
    try {
        const resp = await fetch('/api/backgrounds/all', {
            method: 'POST',
            headers: ctx.getRequestHeaders(),
        });
        console.log('API status:', resp.status);
        const data = await resp.json();
        console.log('API raw:', data);
        if (data.images) {
            console.log('API backgrounds:', data.images.map(b => ({
                filename: b.filename, isAnimated: b.isAnimated
            })));
        }
    } catch (e) {
        console.error('API error:', e);
    }

    // 原生模块
    try {
        const mod = await import('/scripts/backgrounds.js');
        console.log('Native module exports:', Object.keys(mod));
        if (typeof mod.getBackgrounds === 'function') {
            const bgs = await mod.getBackgrounds();
            console.log('getBackgrounds():', bgs);
        }
        if (mod.background_settings) {
            console.log('background_settings:', mod.background_settings);
        }
    } catch (e) {
        console.error('Native module error:', e);
    }

    // API 配置
    console.log('--- APIs ---');
    console.log('Connection Manager:', ctx.extensionSettings?.connectionManager);
    console.log('CONNECT_API_MAP:', ctx.CONNECT_API_MAP);

    // 当前状态
    console.log('--- Current State ---');
    console.log('chat_metadata.custom_background:', ctx.chatMetadata?.['custom_background']);
    console.log('#bg1 backgroundImage:', $('#bg1').css('background-image'));
    console.log('mainApi:', ctx.mainApi);
    console.groupEnd();
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}