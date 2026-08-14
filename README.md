# Character Sync

一个 SillyTavern 扩展，在切换角色时自动同步 **UI 主题**、**聊天背景** 和 **API 连接配置**。

## 功能

- **主题切换**：为每个角色绑定一个 UI 主题，切换角色时自动应用
- **背景切换**：为每个角色绑定一个聊天背景图片，切换角色时自动切换
- **API 连接切换**：为每个角色绑定一个 Connection Manager 连接配置，切换角色时自动切换
- **灵活控制**：总开关 + 三个独立子开关，可精确控制每个同步功能
- **一键清除**：支持单个角色清除绑定，或一键清除所有绑定
- **静默运行**：切换过程不弹出任何 toast 通知，仅在控制台输出日志

## 安装

### 手动和在线安装

将 `character_sync` 文件夹（包含 `index.js`、`manifest.json`、`style.css`）复制到：

```
data/default-user/extensions/ST-CharacterSync/
```

或者输入https://github.com/passers-by149/ST-CharacterSync 在线安装

## 使用方法

### 绑定角色

1. 打开 SillyTavern → 扩展 → 找到 **Character Sync** 设置面板
2. 确保 "启用自动切换" 已勾选
3. 在角色列表中找到你要绑定的角色
4. 分别选择该角色对应的 **主题**、**背景** 和 **API 连接**
5. 设置会自动保存，已绑定的角色行会高亮显示

### 切换开关

- **启用自动切换**：总开关，关闭后所有同步功能暂停，同时清理已锁定的背景
- **切换主题**：是否在切换角色时切换 UI 主题
- **切换背景**：是否在切换角色时切换聊天背景；关闭后会清理之前锁定的背景，防止原生代码恢复
- **切换 API**：是否在切换角色时切换 API 连接配置

### 清除绑定

- 点击角色行右侧的 **清除** 按钮，解除该角色的所有绑定
- 点击 **清除所有绑定** 按钮，一键清除所有角色的绑定

### 刷新列表

点击 **刷新列表** 按钮重新加载主题、背景和 API 配置列表（当你新增了主题/背景/配置后使用）。

## 技术说明

### 主题切换

通过修改 `#themes` 下拉框并触发 `change` 事件来切换主题，与 SillyTavern 原生主题切换机制完全一致。同时兼容 Select2 和原生 select 两种模式。

### 背景切换

**列表获取**（5 层 fallback）：
1. `POST /api/backgrounds/all` — 获取 `/data/<user>/backgrounds/` 下所有图片文件名
2. 目录列表解析 — 从 `/backgrounds/` 静态目录获取 HTML，解析 `<a>` 标签提取图片文件名
3. 导入 `backgrounds.js` 原生模块 — 调用 `getBackgrounds()` 获取列表
4. DOM 查找 — 从页面中已有的背景列表元素中提取选项

**切换机制**：通过写入 `chat_metadata['custom_background']` + `saveMetadata()` + 直接设置 `#bg1` CSS 实现，与 `/lockbg` 命令使用相同的底层机制。

**背景锁清理**：当插件被禁用或背景切换开关关闭时，主动清除 `chat_metadata['custom_background']`，防止 SillyTavern 原生 `backgrounds.js` 模块在 `onChatChanged` 时恢复旧的锁定背景。

### API 连接切换

**切换机制**（3 层 fallback）：
1. `SlashCommandParser.commands['profile'].callback({ await: 'true' }, profileName)` — 调用 Connection Manager 的 `/profile` 命令原生回调，`await=true` 确保连接就绪后才返回
2. DOM 操作 `#connection_profiles` 下拉框触发 `change` 事件 — 走原生 UI 管线
3. `executeSlashCommandsWithOptions('/profile await=true ...', { showOutput: false })` — 兜底方案

**列表获取**（3 层 fallback）：
1. 从 `extension_settings.connectionManager.profiles` 读取
2. 从 `CONNECT_API_MAP` 读取
3. 从 DOM `#connection_profiles` 下拉框读取

### 角色识别

使用角色的 `avatar` 文件名作为稳定键来存储绑定关系，确保即使角色列表重新排序，绑定关系也不会丢失。

## 兼容性

- SillyTavern >= 1.12.0
- 主题切换：无需额外依赖
- 背景切换：无需额外依赖
- API 连接切换：需要 **Connection Manager** 扩展（SillyTavern 内置扩展）

## 致谢

- 主题切换逻辑参考了 [ST-ThemeAssist](https://github.com/Nufahi/ST-ThemeAssist)
- 背景处理参考了 [Background Manager](https://github.com/aceeenvw/background-manager)
- 角色绑定机制参考了 [Character Profile Binder](https://github.com/Klopib/st-character-profile-binder)
