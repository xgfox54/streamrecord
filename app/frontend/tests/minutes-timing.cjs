'use strict';
const {harness}=require('./stream-record-ui.cjs');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
let passed=0;
const test=async(name,fn)=>{await fn();passed++;console.log('PASS '+name);};
const using=async(options,fn)=>{const h=harness(options);await h.mount();try{await fn(h);}finally{await h.unmount();}};
require('./minutes-session.cjs')({test,using,deferred}).then(()=>console.log(JSON.stringify({passed,failed:0}))).catch(error=>{console.error(error);process.exitCode=1;});
