# Caret Agent — Handover (สำหรับคนหรือแชทใหม่ที่รับช่วงต่อ)

อัปเดตล่าสุด: 2026-11-13 · commit ล่าสุด `e24d58d` · repo https://github.com/plawanpawin-byte/Caret-Agent (branch `main`)

> README.md เป็นเอกสารสำหรับผู้ใช้ (ห้ามใส่คำสั่ง dev/npm) — เรื่องสำหรับนักพัฒนาอยู่ในไฟล์นี้เท่านั้น

---

## 1. แอปคืออะไร

**Caret Agent** คือแอปเดสก์ท็อป (Electron 33, Windows เป็นหลัก) ฟรี มี AI ในตัว:
Claude Code, Codex, Grok (xAI), Antigravity (Gemini) มี 2 มุมมอง:

- **Agent** — หน้าแชทเป็นหลักแบบ Claude Code/Codex desktop (ไม่ใช่ IDE)
- **IDE** — ตัวแก้โค้ด (Monaco) + terminal + แผง AI

ทุก AI แชร์ "ความจำโปรเจกต์" ผ่านไฟล์ `.caret/HANDOFF.md` ในโฟลเดอร์ของผู้ใช้ จึงสลับโมเดลกลางงานได้โดยงานไม่หาย
และมี `.caret/DESIGN.md` เป็นกฎกันหน้าตาแบบ "AI slop" ที่ทุก AI ต้องอ่านก่อนสร้าง UI

ผู้ใช้: คนไทย (GitHub `plawanpawin-byte`) อยากได้หน้าตาระดับบริษัท เรียบ ไม่มีของตกแต่งเกินจำเป็น
ห้ามส่งอีเมลผู้ใช้ไปบริการภายนอกเด็ดขาด

---

## 2. โครงสร้างโฟลเดอร์

```
Caret-Agent/
├─ package.json            เวอร์ชัน 0.1.0, deps: monaco-editor 0.52.2, dev: electron 33.4.11, electron-builder 25.1.8
├─ README.md               เอกสารผู้ใช้ (มีรูป docs/ide.png, docs/agent.png — ตอนนี้ล้าสมัย ดูข้อ 9)
├─ LICENSE
├─ resources/              ไอคอนแอป (icon.ico/png) และ DESIGN.md (ต้นฉบับที่ถูกคัดลอกไปใส่ .caret/ ของโปรเจกต์ผู้ใช้)
├─ scripts/
│  ├─ check.js             เช็ก syntax ทุกไฟล์ + รัน selftest  →  `node scripts/check.js` (ตอนนี้ผ่าน 42 ข้อ)
│  ├─ selftest.js          ทดสอบส่วนความปลอดภัย (path, clone URL, permission, breaker, ฯลฯ) รันด้วย Node ล้วน
│  └─ e2e.js               ทดสอบ agent loop จริงแบบไม่มี UI (ต้องมี model จริง รันผ่าน electron)
├─ src/main/               โปรเซสหลัก (CommonJS, Node)
├─ src/preload/preload.js  สะพานเดียวระหว่างหน้าเว็บกับระบบ
└─ src/renderer/           หน้าเว็บ (ES modules ล้วน ไม่มี bundler/framework)
```

---

## 3. สถาปัตยกรรมและความปลอดภัย

- หน้า UI โหลดผ่านโปรโตคอล `caret://app` (ลงทะเบียนใน `main.js`) พร้อม CSP เข้ม:
  `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; …`
  → หน้าเว็บ **เรียกเน็ตเองไม่ได้** ทุกอย่างผ่าน main process
- `contextIsolation`, `sandbox` เปิด; renderer ไม่เห็น Node/ipcRenderer — เห็นแค่ `window.caret` ที่ preload ประกาศ
- ไฟล์ทั้งหมดผ่าน `workspace.js` ซึ่งจำกัดอยู่ในโฟลเดอร์โปรเจกต์ (รวม symlink) และ `.git` เป็น read-only (กัน git hooks)
- API key เข้ารหัสด้วย `safeStorage` (DPAPI/Keychain/libsecret) อยู่ใน main เท่านั้น ไม่ส่งกลับไป renderer
- `main.js` มี test hooks (ไม่ใช้ในการใช้งานปกติ): `CARET_USER_DATA`, `CARET_SCREENSHOT`, `CARET_SCREENSHOT_DELAY`, `CARET_EVAL`, `CARET_EVAL_WAIT`, `CARET_SIZE=WxH`

### IPC ทั้งหมด (`ipcMain.handle` ใน main.js → `window.caret.*` ใน preload.js)

| กลุ่ม | ช่อง | ทำอะไร |
|---|---|---|
| settings | `settings:get/update/setKey` | อ่าน/แก้ค่า (เฉพาะฟิลด์ใน PUBLIC_FIELDS) / เก็บ API key |
| app | `app:info/openExternal/checkUpdate/preview` | เวอร์ชัน, เปิดลิงก์, เช็กอัปเดต, หน้าต่าง preview localhost |
| workspace | `workspace:pick/openRecent/clone/current/close` | เปิดโฟลเดอร์/โคลน git/ปิด |
| fs | `fs:list/read/readImage/write/create/rename/delete/search/files/reveal` | ไฟล์ทั้งหมด; `fs:files` = รายชื่อไฟล์ทั้งโปรเจกต์ (ใช้กับ Go to File) |
| term | `term:create/list/run/kill/close` | terminal |
| providers | `providers:status/install/signIn/checkKey` | สถานะ AI, ติดตั้ง CLI, ล็อกอิน, ตรวจ key |
| models | `models:catalog/hardware` | รายชื่อโมเดลที่ใช้ได้ |
| agent | `agent:list/get/new/rename/delete/send/stop/approve` | แชททั้งหมด + อนุมัติคำสั่ง |

---

## 4. โปรเซสหลัก `src/main/` ทีละไฟล์

**main.js (292 บรรทัด)** — จุดเริ่ม: สร้างหน้าต่าง, ลงทะเบียน `caret://`, CSP, เสิร์ฟไฟล์ renderer + monaco (`serveFile` กันออกนอกโฟลเดอร์), ลงทะเบียน IPC ทั้งหมด,
single-instance lock (เปิดซ้อนไม่ได้ — ตอนทดสอบต้องฆ่า electron ที่ค้างก่อน), zoom Ctrl +/-/0, หน้าต่าง preview localhost, เช็กอัปเดต

**agent.js (462)** — หัวใจ: แท็บแชท + agent loop
- แท็บเก็บใน userData (`loadTabs/persist`), หลายแท็บรันพร้อมกันได้ แต่ละแท็บมี model/mode/permission ของตัวเอง
- `send()` ขั้นตอน: ตรวจ input → บันทึกรูปแนบลง `.caret/attachments/` → `resolveModel` → แยกทาง:
  `claude` → `runners.runClaude`, `codex` → `runners.runCodex`, อื่น ๆ (Grok/Gemini/OpenAI/Anthropic API) → `toolLoop` (วนเรียกโมเดล+เครื่องมือเอง)
- ส่งอีเวนต์ไป renderer: `user/text/thinking/tool/model/url/note/error/done/plan-ready/running`
- หลังจบ: เขียนประวัติ 30 ข้อความล่าสุด, `memory.appendLog`, ถ้า mode=plan และสำเร็จ → เขียน `.caret/PLAN.md` แล้วส่ง `plan-ready` (UI ขึ้นการ์ด "Start coding")
- `requestApproval/answerApproval/gate` = ระบบอนุมัติ (การ์ด Allow/Deny), `startBridge/makeBridge` = เซิร์ฟเวอร์ local ให้ approval-mcp.js ต่อกลับมาถามสิทธิ์
- `compactMessages` ตัดประวัติให้พอดี context, `failedRun` ตัดสินว่ารันล้มเหลว, `friendlyError` แปลง error ให้อ่านง่าย

**runners.js (172)** — คุม CLI จริงด้วย sign-in ของผู้ใช้เอง
- `runClaude`: `claude -p --output-format stream-json --verbose [--model X] [--resume session]`, ใส่ system prompt ผ่านไฟล์ชั่วคราว,
  mode plan → `--permission-mode plan`; permission full → `bypassPermissions`; ask/auto → ตั้ง MCP `caret` (approval-mcp.js) + `--permission-prompt-tool mcp__caret__approve` ให้ทุกการขอใช้เครื่องมือย้อนกลับมาให้แอปตัดสิน
- `runCodex`: `codex exec ... -m model` แปลงอีเวนต์เป็นรูปแบบเดียวกัน
- ทั้งคู่ใช้ `breaker` ตัดการวนรันคำสั่งที่ล้ม และ `killTree` ฆ่า process ทั้งต้น

**breaker.js (39)** — circuit breaker: คำสั่งเดิมล้ม 3 ครั้ง หรือล้มติดกัน 4 คำสั่ง → ตัด (รีเซ็ตเมื่อสำเร็จหรือมีไฟล์เปลี่ยน) ใช้ทั้งใน runners และ toolLoop

**permissions.js (61)** — นโยบายสิทธิ์เดียวของทุก AI
- `ask` ถามทุกการแก้/รันคำสั่ง · `auto` ("Decide for me") อ่าน/แก้ในโปรเจกต์/คำสั่งทั่วไปรันเอง แต่คำสั่งเสี่ยง (rm -rf, git push, sudo, curl|sh, reg, ssh ฯลฯ ใน `RISKY`) หรือนอกโปรเจกต์ยังถาม · `full` ไม่ถามเลย (ไฟล์ยังถูกขังในโปรเจกต์)
- mode plan ปฏิเสธการแก้/รันคำสั่งทั้งหมด
- ฟังก์ชัน: `decide({permission, mode, tool, args, alwaysAllowed})`, `isRiskyCommand`

**approval-mcp.js (63)** — MCP server (stdio) ตัวเล็ก ให้ Claude Code เรียกก่อนใช้เครื่องมือ → ส่งต่อมาที่แอปผ่าน port+token ชั่วคราว

**tools.js (168)** — เครื่องมือสำหรับโมเดลที่แอปขับเอง: `list_dir, read_file, search, write_file, edit_file, delete_file(ลงถังขยะ), run_command, open_preview, update_progress, write_plan` (write_file มีตัวกันการเขียนทับที่ทำให้ไฟล์หายเกือบหมด)

**llm.js (148)** — สตรีมแชท+tool call ไปยัง Ollama (native) และเซิร์ฟเวอร์ที่เข้ากับ OpenAI (Grok, Gemini, OpenAI, Anthropic compat) ข้อความภายในใช้รูปแบบ OpenAI

**models.js (224)** — รวบรวมโมเดลที่ใช้ได้จริง (`catalog()`)
- `CLOUD_APIS`: anthropic / openai / xai / gemini (base URL, filter ชื่อโมเดล, header) — ดึงรายชื่อจริงจาก `/models` ของแต่ละเจ้า **พร้อมกัน** เมื่อมี key
- `CURATED` (เฉพาะแอป CLI): Claude = haiku-5-5, opus-5-5, sonnet-5-5, fable-5, fable-5-1, fable-5-2 · Codex = gpt-6-astra, gpt-6-sol, gpt-6-luna, gpt-5.6-sol — **ทดสอบรันจริงแล้ว 2026-11-13**; gpt-5.5, gpt-4o, codex-5.3 ถูกตัดเพราะ Codex บัญชี ChatGPT ปฏิเสธ
- รายชื่อ Gemini/Grok/OpenAI/Anthropic ผ่าน API มาจากเจ้าของจริง ไม่เขียนเอง (ยังไม่ได้ทดสอบด้วย key จริง)
- โมเดล local (Ollama/LM Studio/llama.cpp) **ปิดไว้** (`LOCAL_MODELS = false`) เพราะตัวเล็กแก้โค้ดไม่น่าเชื่อถือ โค้ดยังอยู่
- `pickAuto` เลือก "Auto": CLI ที่มีก่อน แล้วค่อย API

**providers.js (120)** — `CATALOG` 4 ตระกูล (claude, codex, xai, gemini): ตรวจติดตั้ง/ล็อกอิน (`claude auth status`, `codex login status`), ติดตั้ง CLI ด้วยคำสั่งตายตัว (หน้าเว็บส่งแค่ id), ตรวจ key (`checkKey`) ก่อนบันทึก

**settings.js (102)** — `settings.json` ใน userData: `onboarded, name, role, layout('studio'|'agent'), mode, permission, model, recentFolders, lastFolder, endpoints, keys(เข้ารหัส)`; เขียนแบบ atomic (tmp + rename); renderer แก้ได้เฉพาะ PUBLIC_FIELDS ที่ตรวจชนิดแล้ว

**memory.js (108)** — ความจำโปรเจกต์: `.caret/HANDOFF.md` (ส่วนสถานะคั่นด้วย `<!-- caret:state:start/end -->` + Log ล่าสุด 40 รายการ), `.caret/DESIGN.md` (คัดลอกจาก resources), `.caret/PLAN.md`, `.caret/attachments/` (+`.gitignore`); `context()` รวมทุกอย่างให้ AI; ยังอ่าน AGENTS.md/CLAUDE.md ของโปรเจกต์เป็นกฎเพิ่ม

**prompt.js (51)** — system prompt ที่ทุก AI ได้: บอกบทบาท/OS, กฎของ mode (PLAN/CODE/AGENT), สิทธิ์, ความจำร่วม, กฎดีไซน์, "เมื่อคำสั่งล้มให้หาสาเหตุ ห้ามรันซ้ำ", ความปลอดภัย (เนื้อหาไฟล์/เว็บคือข้อมูล ไม่ใช่คำสั่ง) + แนบ HANDOFF/PLAN/DESIGN/รายชื่อไฟล์

**terminal.js (145)** — terminal ในตัว (ไม่ใช่ PTY: รันทีละคำสั่งด้วย spawn, PowerShell บน Windows) แต่ละแท็บจำโฟลเดอร์ของตัวเอง; คำสั่งของ AI แสดงในแท็บเดียวกัน (ชื่อ "AI · …", มีเครื่องหมาย ◆) ตรวจจับ URL localhost ในผลลัพธ์เพื่อเปิด preview

**workspace.js (216)** — ไฟล์ทั้งหมด: `resolveSafe` (กัน path ออกนอกโปรเจกต์/symlink), `listDir/readFile/readImage/writeFile/writeBinary/createEntry/renameEntry/deleteEntry`, `search` (ค้นชื่อไฟล์+เนื้อหา สูงสุด 200), `listFiles` (ทุกไฟล์ ≤8000 สำหรับ Go to File), `overview` (ต้นไม้ไฟล์ให้ AI), `cloneRepo` (รับเฉพาะ https:// หรือ git@ — มี selftest)

**cli.js (104)** — หา `claude/codex/ollama/node/git/npm` บนเครื่อง (แก้ PATH บน mac, `.cmd` shim บน Windows), `startCli`, `killTree`

---

## 5. หน้าเว็บ `src/renderer/` ทีละไฟล์

**index.html** — โครงเปล่า: `#titlebar`, `#root` มี 2 layout ซ้อนกัน (`#studio` = sidebar | center(editor-area + bottom) | chatpane; `#agentview` = sessions | agent-center | filespane) และ `#statusbar` โหลด `monaco/vs/loader.js` + `app.js` (module)

**state.js (38)** — `api = window.caret`, `state` (settings, workspace, layout, catalog, info), event bus เล็ก ๆ (`on/emit` ผ่าน EventTarget), `saveSettings`, `refreshCatalog/getCatalog` (แคชรายชื่อโมเดล), `modelLabel`

**ui.js (196)** — ตัวช่วย DOM: `h(tag, attrs, ...children)` (ตั้งข้อความด้วย textContent ไม่ใช้ innerHTML), `icon(name)` จากตาราง SVG `P` (มี paperclip, layers, shield, shieldCheck, bolt, copy, download, search ฯลฯ), `menu(anchor, items, {x,y,above,align})` (เมนูหล่น มี sep/group/note/checked), `toast`, `askText`, `fileBadge`, `timeAgo`, `logo`

**app.js (421)** — เปลือกแอป: แถบบน, เมนู, 2 layout, สลับ layout, resize แผง, status bar, ปุ่มลัด, ตัวจัดการคำสั่ง `emit('cmd', …)`
- **แถบบน (36px)**: โลโก้ → ปุ่ม `IDE ▾`/`Agent ▾` (เมนูสลับมุมมอง/เช็กอัปเดต) → เมนู File / Edit / View / Help (ลูกศรซ้าย-ขวาสลับเมนู, Esc ปิด) → ปุ่มสลับแผงขวา (sidebar/terminal/AI/settings) → **ช่องค้นหากลางแถบ** (`.omnibox` แสดงชื่อโฟลเดอร์, กด = เปิด Command Palette)
  - **ข้อควรระวัง**: `.titlebar` เป็น drag region; `omni` ต้องถูก append **ท้ายสุด** ของ titlebar เพื่อให้ no-drag ชนะ spacer ที่ลากได้ (ไม่งั้นเมาส์จริงคลิกไม่ติด ทั้งที่ `.click()` จำลองได้)
- **IDE layout**: ซ้าย sidebar (แถวเครื่องมือ Explorer/Search/⌄ + ต้นไม้ไฟล์/ผลค้นหา) · กลาง editor + terminal ด้านล่าง · ขวา แผง AI (การ์ด) · ขอบลากปรับขนาดได้ (เก็บ localStorage `caret.sizes`)
- **Agent layout**: ซ้าย "New task" (Ctrl T), ค้นแชท, โปรเจกต์ล่าสุด, รายการแชท (คลิกขวา: Rename/Delete), ปุ่มโมเดล+ตั้งค่า · กลาง = แชทเต็มหน้า (+ปุ่ม Files, Terminal, IDE ที่แถบบนของส่วนกลาง) · ขวา = Files (เปิด/ปิดได้)
- `setLayout(l)` ย้าย `chat.el`/`terminal.el`/หน้าโมเดลไปอยู่ใน layout ที่แสดง
- Status bar: โฟลเดอร์, Ln/Col, ภาษา, ปุ่ม Memory (เปิด HANDOFF.md), โมเดล/โหมด
- ปุ่มลัด: Ctrl+O, Ctrl+L, Ctrl+T, Ctrl+B, Ctrl+Alt+B, Ctrl+` , Ctrl+, , Ctrl+Shift+F/E/X (Ctrl+P/Ctrl+Shift+P/F1 อยู่ใน palette.js)
- ค้นไฟล์แบบข้อความใน sidebar (debounce 250ms) แสดงบรรทัดที่ตรงพร้อมไฮไลต์

**palette.js (216)** — Command Palette แบบ VS Code (เปิดจากช่องกลางแถบบน/Ctrl+P/Ctrl+Shift+P/F1)
- หน้าแรก: Go to File, Show and Run Commands `>`, Search for Text `%`, Ask the AI, Go to Symbol `@`, Go to Line `:`, More `?` + "recently opened" (เก็บใน localStorage `caret.recentFiles`)
- พิมพ์ชื่อ → ค้นไฟล์แบบ fuzzy; `>` คำสั่ง; `%` ค้นข้อความ (ผ่าน `fs:search`); `@`/`:` เรียก action ของ Monaco (`quickOutline`, `gotoLine`)
- `buildCommands(ctx)` = **57 คำสั่ง** (ไฟล์/มุมมอง/ค้นหา/AI/terminal/ตั้งค่า/แก้ไขข้อความ/พับโค้ด) — คำสั่งแก้ข้อความส่ง `emit('editor-action', monacoId)`; ไฟล์ใช้ `emit('editor-cmd', 'save'|'save-all'|'close'|'close-all')`
- ยังไม่มี Start Debugging/Run Task (ไม่มีระบบดีบัก; Run Task ทำได้โดยอ่าน scripts จาก package.json — ยังไม่ทำ)

**chat.js (576)** — ตัวแชททั้งหมด (ใช้ได้ 2 แบบ: `panel` ในแถบข้าง IDE, `center` ในหน้า Agent)
- แท็บแชทหลายอัน, ข้อความ (Markdown ปลอดภัยผ่าน markdown.js), การ์ดเครื่องมือสด (กำลังรัน/เสร็จ/ล้ม), การ์ดอนุมัติ Allow/Deny, การ์ด "Plan ready / Start coding", ปุ่มคัดลอก, meta ใต้ข้อความ (โมเดล · โหมด)
- **Prompt bar** (`.composer`): แถวบน = ชิปไฟล์แนบ (ไฟล์ที่เปิดอยู่ถูกแนบอัตโนมัติ + ปุ่ม +); กลาง = textarea (@ เพื่อ mention ไฟล์); แถวล่าง = `[Agent ⌄] [ชื่อโมเดล ⌄] ———— [layers: ค้นทั้งโปรเจกต์] [paperclip: แนบรูป] [shield: สิทธิ์] [ส่ง]`
  - Mode/Model มีชื่อ+ลูกศร; Codebase/แนบ/สิทธิ์เป็นไอคอนล้วนมี tooltip; ไอคอนสิทธิ์เขียวเมื่อ auto, แดงเมื่อ full
  - Modes: Plan (อ่านและวางแผน) / Code / Agent; Perms: `ask`(shield) `auto`(shieldCheck "Decide for me") `full`(bolt)
- เมนูโมเดล (`modelItems`): Auto → กลุ่มต่อผู้ให้บริการ (ป้าย "app on this computer"/"API key") แถวโมเดลไม่มีไอคอน → "Set up" สำหรับ AI ที่ยังไม่ตั้ง → "Models and API keys…"
- แนบรูป: วาง/ลาก/ปุ่ม (สูงสุด 8) ; **คลิกขวารูป (ในกล่องพิมพ์หรือในแชท) → Copy image / Save image** (แปลงเป็น PNG ผ่าน canvas; ยังไม่ได้ทดสอบกดจริงทั้งสองปุ่ม)
- ส่งข้อความล้มเหลวต้องไม่ค้างสถานะ "working" (แก้แล้วใน commit `9d12fb2`)

**editor.js (216)** — Monaco (ธีม `caret` ดำ #181818 เคอร์เซอร์สีอำพัน) + แท็บไฟล์ (จุดแสดงยังไม่บันทึก, Ctrl+S), พรีวิวรูป, รีโหลดไฟล์ที่ AI แก้ (ถ้าผู้ใช้ไม่ได้แก้ค้าง), minimap ซ่อนเมื่อแคบ (<520px); หน้า "ไม่มีโฟลเดอร์"/"ไม่มีไฟล์" (ปุ่มเปิดโฟลเดอร์/โคลน/ไฟล์ล่าสุด + ทางลัด Ask the AI, Search, Terminal, Project memory); event: `open-file`, `editor-action`, `editor-cmd`, `workspace`, `fs-changed`, `file-renamed/deleted`

**explorer.js (128)** — ต้นไม้ไฟล์ โหลดโฟลเดอร์ตอนเปิด จำโฟลเดอร์ที่เปิดไว้ข้ามการรีเฟรช เส้นนำสายตาบาง ๆ แสดงระดับซ้อน; เมนูคลิกขวา: Open, New file/folder here, Add to chat, Copy path, Reveal in file manager, Rename, Move to recycle bin; `createExplorer({title, onOpen})` ใช้ทั้ง sidebar และ filespane ของ Agent

**terminal.js (113)** — แผง terminal: แท็บ, ช่องพิมพ์คำสั่ง, ผลลัพธ์สด; คำสั่งของ AI ขึ้นพร้อม ◆ และเปิดแผงให้อัตโนมัติ (`show-bottom`)

**providers.js (218)** — หน้า "Models and API keys" (เปิดจากเมนูโมเดล ไม่มีแผง/ไอคอน providers แยกแล้ว): การ์ดต่อ AI (Claude/Codex มีแท็บ App | API key; Grok/Antigravity ใช้ key), ติดตั้ง/ล็อกอินปุ่มเดียว, ช่อง key (ซ่อน/แสดง, ตรวจก่อนบันทึก), Esc ปิดจากทุกที่ (ปิดทีละชั้น)

**dialogs.js (179)** — onboarding ครั้งแรก (ชื่อ/บทบาท/layout/ปุ่ม "Set up an AI"), Settings, Clone dialog

**markdown.js (92)** — Markdown→HTML แบบ escape ก่อนเสมอ (ลิงก์เปิดในเบราว์เซอร์ระบบ) · **brands.js (38)** — โลโก้ AI วาดเป็น SVG ในโค้ด (ไม่โหลดจากเน็ต) · **monaco-worker.js** — worker เป็นไฟล์จริง (ไม่ใช้ blob เพื่อคง CSP)

**styles.css (985)** — สไตล์ทั้งหมด ไฟล์เดียว เรียงเป็นชั้น ๆ (ชั้นหลัง override ชั้นก่อน): ฐาน → IDE → Agent → "v10 prompt bar" → "v11 command palette" (ท้ายไฟล์)
- โทเค็น (`:root`): `--bg #181818`, `--panel/--bar #141414`, `--surface #1f1f1f`, `--surface-2 #2a2a2a`, `--border #262626`, `--text #ccc`, `--text-hi #ededed`, `--muted #8b8b8b`, `--accent #f0a63a` (อำพัน: ใช้เฉพาะโฟกัส/เส้นแท็บที่ active/เครื่องหมายคาเร็ต), `--ok/--warn/--danger`, `--radius 4px`, `--radius-lg 8px`, `--titlebar 36px`
- ฟอนต์: Segoe UI Variable + Noto Sans Thai/Leelawadee (ตัวอักษรไทยถูกขยายให้ขนาดเท่าละติน), mono: Cascadia Code
- breakpoint สำคัญ: ≤1100px ซ่อน omnibox + แผงแคบลง

---

## 6. UI — ภาพรวมที่ผู้ใช้เห็น

1. **เปิดครั้งแรก**: onboarding (ชื่อ, บทบาท, เลือก Agent/IDE, ปุ่มตั้งค่า AI)
2. **IDE**: แถบบน → [sidebar ไฟล์ | editor + terminal | แผง AI]; status bar ล่าง
3. **Agent**: [รายการงาน/โปรเจกต์/แชท | แชทกลางหน้าจอ | Files (ซ่อนได้)]; ปุ่ม Files/Terminal/IDE มุมขวาบนของส่วนกลาง
4. **เลือกโมเดล**: ปุ่มชื่อโมเดลในแถบพรอมต์ → เมนู → "Models and API keys…" เปิดหน้าเต็มทับพื้นที่กลาง
5. **ค้น/สั่งงาน**: กดช่องกลางแถบบนหรือ Ctrl+P
6. **Plan flow**: เลือก Plan → AI เขียนแผน (บันทึก `.caret/PLAN.md`) → การ์ด "Start coding" (ถ้าสิทธิ์ Full เริ่มโค้ดเอง)
7. หลักการดีไซน์: เรียบ เทาสนิท, ไม่มีไล่สี/กระจกฝ้า/อีโมจิเป็นไอคอน, คำ UI สั้น, ไอคอนล้วนแทนข้อความเมื่อความหมายชัด

---

## 7. วิธีรัน/ทดสอบ/สร้างตัวติดตั้ง (Windows)

```
node scripts/check.js                    # syntax + selftest (ต้องผ่าน 42/42)
node_modules\electron\dist\electron.exe .   # รันแอป (ต้อง npm install มาก่อน)
```

**ถ่ายภาพหน้าจอ/ทดสอบ UI แบบไม่ต้องมีคนกด** (ตั้ง env แล้วรัน electron.exe .): `CARET_USER_DATA=<โฟลเดอร์โปรไฟล์ทดสอบ>`, `CARET_SCREENSHOT=out.png`, `CARET_SCREENSHOT_DELAY=3500`, `CARET_EVAL="<js>"`, `CARET_EVAL_WAIT=1500`, `CARET_SIZE=1440x900`
- แอปเป็น single-instance: ก่อนรันรอบใหม่ต้องฆ่า electron.exe ที่ค้าง (ฆ่าเฉพาะที่ path ตรงโปรเจกต์) ไม่งั้นรอบหลังจะไม่ได้ภาพ/ได้ภาพเก่า
- การคลิกจำลองด้วย `element.click()` ข้ามพื้นที่ drag ของ Electron — ไม่ใช่หลักฐานว่าเมาส์จริงคลิกได้

**สร้างตัวติดตั้ง** (path ยาวทำให้ build พัง ต้อง build จากโฟลเดอร์สั้น):
```
robocopy <repo> C:\cb /MIR /XD dist .git node_modules     # exit code < 8 = ปกติ
cd C:\cb ; npx electron-builder --win nsis                  # ~2+ นาที
→ C:\cb\dist\Caret Agent Setup 0.1.0.exe   (≈96 MB, ไม่เซ็นชื่อ → SmartScreen เตือน: More info → Run anyway)
```
(โฟลเดอร์ `C:\cb` ต้องมี node_modules ติดตั้งไว้แล้ว)

**Commit**: ใช้ `git -c user.name="plawanpawin-byte" -c user.email="plawanpawin@users.noreply.github.com" commit …` และปิดท้ายข้อความด้วย
`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`

**ข้อควรระวังเครื่องมือ**: shell heredoc/sed ทำ backslash หาย (ใช้ Edit/Write แทน) · PowerShell `Set-Content -Encoding utf8` ใส่ BOM ทำให้ JSON ตั้งค่าพัง · Git เตือน LF→CRLF เป็นเรื่องปกติ

---

## 8. สิ่งที่ยืนยันแล้ว / ยังไม่ยืนยัน

**ยืนยันแล้ว**
- `node scripts/check.js` ผ่าน 42 ข้อ (ล่าสุด 2026-11-13)
- Claude Code (haiku, โหมด agent, สิทธิ์ auto) และ Codex ผ่าน `scripts/e2e.js`: เขียนไฟล์, รันคำสั่ง, อัปเดต HANDOFF.md ได้
- Plan flow กับ Claude (ask + full) และ Codex แบบ headless
- ทดสอบรันโมเดลผ่าน CLI จริง: Claude 6 ตัวและ Codex 4 ตัวในรายการ CURATED ตอบได้ (Fable 5.2 มีคำเตือน "unrecognized_model" ใน CLI แต่ `modelUsage` ยืนยันว่าใช้ `claude-fable-5-2` ได้จริง)
- UI: ดูภาพหน้าจอแล้ว — prompt bar (1440×900, 1100×800), Command Palette (หน้าแรก/รายการคำสั่ง/ค้นไฟล์/สั่ง Toggle Terminal ได้จริง), เมนูคลิกขวารูป (ขึ้น 2 รายการ)

**ยังไม่ยืนยัน (ต้องให้ผู้ใช้หรือ key จริง)**
- คลิกช่องค้นหากลางแถบบนด้วย **เมาส์จริง** หลังแก้ลำดับ drag/no-drag (commit `a835207`) — ผู้ใช้รายงานก่อนหน้านี้ว่ากดไม่ได้ ยังไม่มีคำยืนยันว่าหายแล้ว
- Copy image / Save image ทำงานจริง (คัดลอกเข้า clipboard, ดาวน์โหลดไฟล์) — เห็นแค่เมนูขึ้น
- คำสั่งแก้ข้อความของ palette (Sort Lines ฯลฯ) และการค้น `%`
- Anthropic API key (ผ่าน endpoint ที่เข้ากับ OpenAI — Anthropic เรียกว่าเลเยอร์ทดสอบ/เปรียบเทียบ ไม่ใช่ production), Grok, Antigravity/Gemini, OpenAI API ด้วย key จริง
- breaker กับ AI ที่วนจริง (ทดสอบกับตัวจำลอง ไม่ใช่ตัวจริง)
- ตัวติดตั้งบนเครื่องสะอาด / การเซ็นชื่อโค้ด
- ปุ่ม Codebase แบบ `.on` และหน้าต่างแคบมากหลังแก้ prompt bar (ยังไม่ได้ถ่ายภาพ)
- `claude auth` ของเครื่องนี้ใกล้หมดอายุ 2026-11-16..19 (มีคำเตือนจาก CLI) — ผู้ใช้ต้อง `claude auth login` ใหม่ ไม่เกี่ยวกับโค้ด

---

## 9. งานที่ค้าง / ไอเดียถัดไป

1. **รูปใน README ล้าสมัย**: `docs/ide.png`, `docs/agent.png` ยังเป็น UI เก่า (มี Composer/prompt bar เก่า) → ถ่ายใหม่แล้วแทน (ไม่ต้องแก้ข้อความ README มาก)
2. ให้ผู้ใช้ทดสอบข้อที่ "ยังไม่ยืนยัน" ข้างบน โดยเฉพาะคลิกช่องค้นหาด้วยเมาส์จริง
3. Run Task ใน palette (อ่าน scripts จาก package.json ของโปรเจกต์ → รันใน terminal) — ผู้ใช้เคยเห็นใน VS Code ตัวอย่าง; Start Debugging ทำไม่ได้ (ไม่มีดีบักเกอร์)
4. ทางเลือก: ช่องกลางแถบบนแสดงชื่อ **แท็บที่เปิดอยู่** แทนชื่อโฟลเดอร์ (ผู้ใช้ยังไม่ตอบว่าต้องการไหม)
5. เซ็นชื่อตัวติดตั้ง (ต้องซื้อใบรับรอง) และ/หรือประกาศ GitHub Release (**ต้องให้ผู้ใช้อนุญาตก่อนเสมอ** — ห้ามเผยแพร่เอง)
6. ถ้า Antigravity/Gemini ให้ key มา → ทดสอบรายชื่อโมเดลจริง (ผู้ใช้บอกว่าโมเดลใน Antigravity ส่วนใหญ่ใช้ไม่ได้ จึงปล่อยให้ดึงจาก API เท่านั้น)

---

## 10. หลักการทำงานกับผู้ใช้คนนี้

- พูดไทย กระชับ ไม่ถามวน ถ้าคลุมเครือให้เลือกการตีความที่น่าจะใช่ที่สุดแล้วทำ/อธิบายสั้น ๆ
- ผู้ใช้เปิด/ส่งภาพหน้าจอเป็นหลัก — ถ้าบอกว่า "กดไม่ได้" ให้สงสัยปัญหาของเมาส์จริง (drag region, z-order) ไม่ใช่แค่ตรรกะ
- ส่งไฟล์ติดตั้งใหม่ (`SendUserFile`) ทุกครั้งที่แก้ UI แล้วบอกชัดว่าอะไรยืนยันแล้ว/ยังไม่ได้ลอง
- ห้ามเผยแพร่ release, ห้ามส่งอีเมลผู้ใช้ออกนอกเครื่อง
