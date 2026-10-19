// Released SQL migration bytes are immutable; new schema changes require a new migration.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const released={
  "20250916100000_initial_schema.sql": ["298f47afaa1fe9b3","312bc1d9d23d0bc7","80bdd12f54206df6","90b5aa7c1117bc3d","1c40d99918d7266e","5522bd86ef8d7793"].join(''),
  "20250920155811_add_openrouter_api_key.sql": ["e006a52615896541","acce6ea2ba1e9181","09976d78792b70a4","1ecc94f07ed255db","d79038a6022f1c7c","5e9e8803d0b2d3d0"].join(''),
  "20251006000000_add_audio_sync_fields.sql": ["9ac46a88e49d20e3","b665d79912134c14","106460675dd8aa70","ecb3eb25e934bd9f","da102a6c2a932078","f44671c30c8640a4"].join(''),
  "20251010153942_add_ollama_endpoint.sql": ["eb12baae2c08a048","7c28ae64eb18c1f1","15cb110c5bc6ba12","7322b1952e06367b","1e26c45c0642c26e","a153e7729edb2cc2"].join(''),
  "20251101000000_add_summary_backup.sql": ["07d6ed23b60c0af3","de7cb1891c9c3a79","c0310c9d6e857e04","41e1615f7574cb62","f44329cc318af386","f3d23a9b7c8a3950"].join(''),
  "20251105120000_add_pro_license_custom_openai.sql": ["e91730ceb5dca556","da33c49daa79db82","0b8d499f8a246e63","97168a1b56b3b15a","4001dc20dc74b787","7206e8bc2213fa2f"].join(''),
  "20251110000000_add_grace_period_to_licensing.sql": ["f11c86bf0ef57c6d","aec61a7f1de4f403","c5fe6d9aafdf1677","229db777b711935b","e633279a37efcb8e","6555b1438fb0bea8"].join(''),
  "20251110000001_add_speaker_field.sql": ["c5d436603d3fc947","28c62eb1cbeb2224","5ad345dfabefdc2d","29e679204af24c5c","966c8b4b1caeed4b","de1f2a706c24613e"].join(''),
  "20251223000000_add_meeting_notes.sql": ["d9024f5483da5adc","fe3cae4fccea9c5b","e755d9e46f25aa66","6b4d40a466dd3fc2","039e1a2998d7c5ac","63c4777eb9392377"].join(''),
  "20251229000000_add_gemini_api_key.sql": ["806e0cfce84a9a7a","8cbc7bd19c33a040","963913b57a6f2893","2b5ff3fbdaa111af","f290fc5fd8d5b449","1b61b8aa69b5a6a9"].join(''),
  "20260928000000_add_versioned_transcription_runs.sql": ["58910b93e4f7da51","f893e2bf5deddd03","bba952ba1e1696e0","b6a387ce99abf2f9","dc297731d1d5eeb2","18aec75f3ba17ff8"].join('')
};
for(const [file,expected] of Object.entries(released)){
 const bytes=fs.readFileSync(path.join(root,'app/frontend/src-tauri/migrations',file));
 assert.equal(createHash('sha384').update(bytes).digest('hex'),expected,'Released SQL bytes changed: '+file);
}
console.log(JSON.stringify({passed:Object.keys(released).length,failed:0,scope:'Released migration checksums including line endings'}));
