// Released SQL migration bytes are immutable; new schema changes require a new migration.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const released={
  "20250916100000_initial_schema.sql": "298f47afaa1fe9b3312bc1d9d23d0bc780bdd12f54206df690b5aa7c1117bc3d1c40d99918d7266e5522bd86ef8d7793",
  "20250920155811_add_openrouter_api_key.sql": "e006a52615896541acce6ea2ba1e918109976d78792b70a41ecc94f07ed255dbd79038a6022f1c7c5e9e8803d0b2d3d0",
  "20251006000000_add_audio_sync_fields.sql": "9ac46a88e49d20e3b665d79912134c14106460675dd8aa70ecb3eb25e934bd9fda102a6c2a932078f44671c30c8640a4",
  "20251010153942_add_ollama_endpoint.sql": "eb12baae2c08a0487c28ae64eb18c1f115cb110c5bc6ba127322b1952e06367b1e26c45c0642c26ea153e7729edb2cc2",
  "20251101000000_add_summary_backup.sql": "07d6ed23b60c0af3de7cb1891c9c3a79c0310c9d6e857e0441e1615f7574cb62f44329cc318af386f3d23a9b7c8a3950",
  "20251105120000_add_pro_license_custom_openai.sql": "e91730ceb5dca556da33c49daa79db820b8d499f8a246e6397168a1b56b3b15a4001dc20dc74b7877206e8bc2213fa2f",
  "20251110000000_add_grace_period_to_licensing.sql": "f11c86bf0ef57c6daec61a7f1de4f403c5fe6d9aafdf1677229db777b711935be633279a37efcb8e6555b1438fb0bea8",
  "20251110000001_add_speaker_field.sql": "c5d436603d3fc94728c62eb1cbeb22245ad345dfabefdc2d29e679204af24c5c966c8b4b1caeed4bde1f2a706c24613e",
  "20251223000000_add_meeting_notes.sql": "d9024f5483da5adcfe3cae4fccea9c5be755d9e46f25aa666b4d40a466dd3fc2039e1a2998d7c5ac63c4777eb9392377",
  "20251229000000_add_gemini_api_key.sql": "806e0cfce84a9a7a8cbc7bd19c33a040963913b57a6f28932b5ff3fbdaa111aff290fc5fd8d5b4491b61b8aa69b5a6a9",
  "20260928000000_add_versioned_transcription_runs.sql": "58910b93e4f7da51f893e2bf5deddd03bba952ba1e1696e0b6a387ce99abf2f9dc297731d1d5eeb218aec75f3ba17ff8"
};
for(const [file,expected] of Object.entries(released)){
 const bytes=fs.readFileSync(path.join(root,'app/frontend/src-tauri/migrations',file));
 assert.equal(createHash('sha384').update(bytes).digest('hex'),expected,'Released SQL bytes changed: '+file);
}
console.log(JSON.stringify({passed:Object.keys(released).length,failed:0,scope:'Released migration checksums including line endings'}));
