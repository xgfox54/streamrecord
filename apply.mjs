import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
const read = p => fs.readFileSync(p, 'utf8');
const installerVersion = 5;
const onlyOnce = (text, token) => {
  if (text.split(token).length !== 2) throw new Error(`Unsupported upstream structure: ${token}`);
};
const commands = ['ko_start_recording', 'ko_stop_recording', 'ko_validate_video', 'ko_open_video', 'ko_close_video', 'ko_models', 'ko_generate', 'ko_export', 'ko_save_snapshot', 'ko_load_snapshot'];
export function patchRecordingCommands(source) {
  source = source.replace(/\r\n/g, '\n');
  if (!source.includes('pub const EXACT_MIC_DEVICE_PREFIX')) {
    const microphoneHead = `fn resolve_mic_or_default<R: Runtime>(
    app: &AppHandle<R>,
    requested_name: Option<&str>,
) -> Option<Arc<super::AudioDevice>> {`;
    onlyOnce(source, microphoneHead);
    source = source.replace(microphoneHead, `pub const EXACT_MIC_DEVICE_PREFIX: &str = "__meetily_korean_exact_mic__:";

${microphoneHead}
    if let Some(name) = requested_name.and_then(|value| value.strip_prefix(EXACT_MIC_DEVICE_PREFIX)) {
        let exact = parse_audio_device(name).ok().filter(|device| {
            use cpal::traits::{DeviceTrait, HostTrait};
            cpal::default_host().input_devices()
                .map(|mut devices| devices.any(|candidate| candidate.name().map(|n| n == device.name).unwrap_or(false)))
                .unwrap_or(false)
        });
        if exact.is_none() {
            let _ = app.emit("mic-unavailable", serde_json::json!({ "device_name": name }));
        }
        return exact.map(Arc::new);
    }`);
    const customStart = 'pub async fn start_recording_with_devices_and_meeting<R: Runtime>(';
    const customIndex = source.indexOf(customStart);
    if (customIndex < 0) throw new Error(`Unsupported upstream structure: ${customStart}`);
    let customTail = source.slice(customIndex);
    const lifecycle = '    let engine_lifecycle_guard = super::common::acquire_engine_lifecycle_lock().await;';
    onlyOnce(customTail, lifecycle);
    customTail = customTail.replace(lifecycle, `${lifecycle}\n    let exact_microphone = mic_device_name.as_deref().is_some_and(|name| name.starts_with(EXACT_MIC_DEVICE_PREFIX));`);
    const fallbackSpawn = `    // Spawn background device event processor (mic-disconnect fallback).
    if let Some(receiver) = device_event_receiver {
        spawn_device_event_processor(app.clone(), receiver, session);
    }`;
    onlyOnce(customTail, fallbackSpawn);
    customTail = customTail.replace(fallbackSpawn, `    // Exact-input sessions must stop or error if their chosen input disappears.
    if !exact_microphone {
        if let Some(receiver) = device_event_receiver {
            spawn_device_event_processor(app.clone(), receiver, session);
        }
    }`);
    source = source.slice(0, customIndex) + customTail;
  }
  if (!source.includes('pub const DISABLED_SYSTEM_AUDIO_DEVICE')) {
    const functionHead = 'fn resolve_system_or_default(requested_name: Option<&str>) -> Option<Arc<super::AudioDevice>> {';
    onlyOnce(source, functionHead);
    source = source.replace(functionHead, `pub const DISABLED_SYSTEM_AUDIO_DEVICE: &str = "__meetily_korean_disabled_system_audio__";

${functionHead}
    if requested_name == Some(DISABLED_SYSTEM_AUDIO_DEVICE) {
        return None;
    }`);
  }
  if (source.includes('let manager_to_stop = {')) return source;
  const managerBlock = `let manager_for_cleanup = {
        let mut global_manager = RECORDING_MANAGER.lock().unwrap();
        global_manager.take()
    };`;
  onlyOnce(source, managerBlock);
  source = source.replace(managerBlock, managerBlock.replace('manager_for_cleanup', 'manager_to_stop'));
  const stopBlock = `let stop_result = if let Some(mut manager) = manager_for_cleanup {
        // Use FORCE FLUSH to immediately process all accumulated audio - eliminates 30s delay!
        info!("🚀 Using FORCE FLUSH to eliminate pipeline accumulation delays");
        let result = manager.stop_streams_and_force_flush().await;
        // Store manager back for later cleanup
        let manager_for_cleanup = Some(manager);
        (result, manager_for_cleanup)
    } else {
        warn!("No recording manager found to stop");
        (Ok(()), None)
    };

    let (stop_result, manager_for_cleanup) = stop_result;`;
  onlyOnce(source, stopBlock);
  source = source.replace(stopBlock, `let stop_result = if let Some(mut manager) = manager_to_stop {
        info!("🚀 Using FORCE FLUSH to eliminate pipeline accumulation delays");
        let result = manager.stop_streams_and_force_flush().await;
        RECORDING_MANAGER.lock().unwrap().replace(manager);
        result
    } else {
        warn!("No recording manager found to stop");
        Ok(())
    };`);
  const earlyUnlisten = `    // Step 1.5: Clean up transcript listener to release microphone
    // Unlisten transcript-update event to prevent lingering references
    {
        use tauri::Listener;
        if let Some(listener_id) = TRANSCRIPT_LISTENER_ID.lock().unwrap().take() {
            app.unlisten(listener_id);
            info!("✅ Transcript-update listener removed");
        }
    }

`;
  onlyOnce(source, earlyUnlisten);
  source = source.replace(earlyUnlisten, '');
  const timeoutBlock = `        // Wait up to 10 minutes for transcription completion to prevent indefinite hangs
        match tokio::time::timeout(
            tokio::time::Duration::from_secs(600), // 10 minutes max
            task_handle
        ).await {
            Ok(Ok(())) => {
                info!("✅ ALL transcription chunks processed successfully - no data lost");
            }
            Ok(Err(e)) => {
                warn!("⚠️ Transcription task completed with error: {:?}", e);
                // Continue anyway - the worker may have processed most chunks
            }
            Err(_) => {
                warn!("⏱️ Transcription timeout (10 minutes) reached, continuing shutdown to prevent indefinite hang");
                // Continue shutdown even on timeout - better to lose some chunks than hang forever
            }
        }`;
  onlyOnce(source, timeoutBlock);
  source = source.replace(timeoutBlock, `        task_handle.await
            .map_err(|e| format!("Transcription task failed before all chunks were saved: {e}"))?;
        info!("✅ ALL transcription chunks processed successfully - no data lost");`);
  const stepThree = '    // Step 3: Now safely unload Whisper model after ALL chunks are processed';
  onlyOnce(source, stepThree);
  source = source.replace(stepThree, `    {
        use tauri::Listener;
        if let Some(listener_id) = TRANSCRIPT_LISTENER_ID.lock().unwrap().take() {
            app.unlisten(listener_id);
            info!("✅ Transcript-update listener removed");
        }
    }
    let manager_for_cleanup = RECORDING_MANAGER.lock().unwrap().take();

${stepThree}`);
  return source;
}
export function applyOverlay(base, target) {
  base = path.resolve(base); target = path.resolve(target);
  if (!target.startsWith(base + path.sep)) throw new Error('Target must be inside this project.');
  const manifestPath = path.join(target, 'meeting-ko-install.json');
  const files = {};
  const walk = (dir, prefix = '') => {
    for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
      const rel = prefix + entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Symlink refused: ${rel}`);
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel + '/');
      else if (entry.isFile()) files[rel] = fs.readFileSync(path.join(dir, entry.name));
    }
  };
  walk(path.join(base, 'overlay'));
  const overlayHash = digest(installerVersion + '\n' + Object.keys(files).sort().map(p => p + ':' + digest(files[p])).join('\n'));
  let previousManifest = null;
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(read(manifestPath));
    if (manifest.status !== 'complete') throw new Error('Previous installation was interrupted. Preserve app/ and inspect its backups.');
    for (const [rel, expected] of Object.entries(manifest.outputs)) {
      if (!fs.existsSync(path.join(target, rel)) || digest(fs.readFileSync(path.join(target, rel))) !== expected) throw new Error(`Local changes detected; not overwritten: ${rel}`);
    }
    if (manifest.overlayHash === overlayHash) return {alreadyApplied:true, fileCount:Object.keys(manifest.outputs).length};
    previousManifest = manifest;
  }
  const libPath = 'frontend/src-tauri/src/lib.rs';
  const pagePath = 'frontend/src/app/page.tsx';
  const layoutPath = 'frontend/src/app/layout.tsx';
  const configPath = 'frontend/src-tauri/tauri.conf.json';
  const audioPath = 'frontend/src-tauri/src/audio/recording_commands.rs';
  const backup = path.join(target, '.meeting-ko-originals');
  const sourceFor = rel => fs.existsSync(path.join(backup, rel)) ? read(path.join(backup, rel)) : read(path.join(target, rel));
  const lib = sourceFor(libPath);
  const home = sourceFor(pagePath);
  const layout = sourceFor(layoutPath);
  const config = JSON.parse(sourceFor(configPath));
  const audio = sourceFor(audioPath);
  const imports = read(path.join(target, 'frontend/src-tauri/src/audio/import.rs'));
  const api = read(path.join(target, 'frontend/src-tauri/src/api/api.rs'));
  for (const token of ['pub mod api;', 'tauri::generate_handler![']) onlyOnce(lib, token);
  for (const token of ['struct RecordingArgs', 'save_path: String', 'async fn start_recording', 'async fn stop_recording', 'set_language_preference', 'get_audio_devices', 'get_transcript_history']) {
    if (!lib.includes(token)) throw new Error(`Upstream native contract missing: ${token}`);
  }
  for (const token of ['start_recording_with_devices_and_meeting', 'mic_device_name', 'system_device_name', 'transcript-update']) {
    if (!audio.includes(token)) throw new Error(`Audio contract missing: ${token}`);
  }
  for (const token of ['select_and_validate_audio_command','start_import_audio_command','is_import_in_progress_command','import-complete','import-progress','import-error']) {
    if (!imports.includes(token)) throw new Error(`Import contract missing: ${token}`);
  }
  for (const token of ['api_get_transcript_config','api_get_meeting_transcripts','limit: i64','offset: i64']) {
    if (!api.includes(token)) throw new Error(`Database contract missing: ${token}`);
  }
  if (lib.includes('mod meeting_ko;')) throw new Error('Existing untracked overlay detected. No overwrite performed.');
  files[libPath] = Buffer.from(lib.replace('pub mod api;', 'mod meeting_ko;\npub mod api;').replace('tauri::generate_handler![', 'tauri::generate_handler![\n' + commands.map(c => `            meeting_ko::${c},`).join('\n')));
  files[audioPath] = Buffer.from(patchRecordingCommands(audio));
  const layoutImport = "import { isAudioExtension, getAudioFormatsDisplayList } from '@/constants/audioFormats'";
  const layoutBody = '<body className={`${sourceSans3.variable} font-sans antialiased`}>';
  for (const token of [layoutImport, '<html lang="en">', layoutBody]) onlyOnce(layout, token);
  files[layoutPath] = Buffer.from(layout.replace(layoutImport, layoutImport + "\nimport KoreanLocalizer from '@/components/KoreanLocalizer'").replace('<html lang="en">', '<html lang="ko">').replace(layoutBody, layoutBody + '\n        <KoreanLocalizer />'));
  const relocatedHome = home.replace(/(from\s+["'])(\.\.?\/[^"']+)(["'])/g, (_, start, rel, end) => start + '@/' + path.posix.normalize(path.posix.join('app', rel)) + end);
  files['frontend/src/app/_components/MeetilyOriginalHome.tsx'] = Buffer.from(relocatedHome);
  files['frontend/src/app/upstream/page.tsx'] = Buffer.from(`'use client';\nimport OriginalHome from '@/app/_components/MeetilyOriginalHome';\nexport default function Upstream(){return <><div style={{position:'fixed',right:24,top:12,zIndex:1000,background:'white',padding:10,border:'1px solid #bbb',borderRadius:8}}><a href="/">한국어 회의록 작업실로 돌아가기</a></div><OriginalHome/></>;}\n`);
  // Keep the identifier used by prior Meetily-Korean builds so settings and downloaded models remain available.
  config.identifier = 'local.meetily.korean.workspace';
  config.productName = 'stream-record';
  config.mainBinaryName = 'stream-record';
  config.version = '0.0.1';
  config.build = {...config.build, beforeDevCommand:'npm run dev', beforeBuildCommand:'npm run build'};
  if (config.bundle) config.bundle.createUpdaterArtifacts = false;
  for (const window of config.app?.windows || []) { window.title = 'stream-record · 실시간 회의록'; window.width = Math.max(window.width || 0, 1250); window.height = Math.max(window.height || 0, 850); }
  files[configPath] = Buffer.from(JSON.stringify(config, null, 2) + '\n');
  const originalPaths = new Set([libPath, pagePath, layoutPath, configPath, audioPath]);
  for (const rel of Object.keys(files)) {
    const dest = path.join(target, rel);
    if (!dest.startsWith(target + path.sep)) throw new Error('Invalid overlay path.');
    const previouslyOwned = previousManifest && Object.hasOwn(previousManifest.outputs, rel);
    if (fs.existsSync(dest) && !originalPaths.has(rel) && !previouslyOwned && digest(fs.readFileSync(dest)) !== digest(files[rel])) throw new Error(`Refusing to overwrite existing file: ${rel}`);
  }
  // Validate everything before mutating. Backups remain available on any subsequent error.
  for (const rel of originalPaths) { const dest = path.join(backup, rel); fs.mkdirSync(path.dirname(dest), {recursive:true}); if(!fs.existsSync(dest))fs.copyFileSync(path.join(target, rel), dest, fs.constants.COPYFILE_EXCL); }
  const manifest = {schema:3,installerVersion,status:'applying',overlayHash,outputs:{},createdAt:new Date().toISOString()};
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  for (const [rel, data] of Object.entries(files)) {
    const dest = path.join(target, rel); fs.mkdirSync(path.dirname(dest), {recursive:true});
    fs.writeFileSync(dest, data); manifest.outputs[rel] = digest(data);
  }
  manifest.status = 'complete'; fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return {alreadyApplied:false,fileCount:Object.keys(files).length};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const base = path.dirname(fileURLToPath(import.meta.url)); console.log(applyOverlay(base, path.join(base, 'app'))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
