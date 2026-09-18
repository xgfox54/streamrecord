import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const css=fs.readFileSync(path.join(root,'app/frontend/src/components/meeting-ko/workspace.module.css'),'utf8');
const tokens=Object.fromEntries([...css.slice(0,css.indexOf("}")).matchAll(/--sr-([\w-]+)\s*:\s*([^;}]+)[;}]/g)].map(m=>[m[1],m[2].trim()]));
function color(name){const value=tokens[name];assert.ok(value,'Unknown token '+name);const ref=value.match(/^var\(--sr-([\w-]+)\)$/);return ref?color(ref[1]):value;}
function luminance(hex){assert.match(hex,/^#[0-9a-f]{6}$/i);const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;}
function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
assert.equal(color('brand-blue'),'#0173bc');assert.equal(color('brand-orange'),'#f18101');assert.equal(color('brand-green'),'#00a074');
const pairs=[['text','surface',4.5],['text','surface-subtle',4.5],['text-subtle','surface',4.5],['text-subtle','surface-subtle',4.5],['action-primary-fg','action-primary-bg',4.5],['action-primary-fg','primary-hover',4.5],['action-primary-fg','primary-pressed',4.5],['on-orange','progress-accent',4.5],['on-green','success-accent',4.5],['disabled-text','disabled-bg',4.5],['primary-hover','surface-selected',4.5],['danger','danger-surface',4.5],['border-control','surface',3],['border-control','surface-subtle',3],['focus','surface',3],['focus','surface-selected',3]];
const result=pairs.map(([foreground,background,minimum])=>{const fg=color(foreground),bg=color(background),ratio=contrast(fg,bg);return {foreground,background,fg,bg,ratio:Number(ratio.toFixed(4)),minimum,passed:ratio>=minimum};});
const output={scope:'Opaque token contrast; actual rendered states and forced colors require UI verification',passed:result.every(r=>r.passed),result};
if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(output,null,2));
console.log(JSON.stringify(output,null,2));assert.ok(output.passed,'Contrast threshold failed');

