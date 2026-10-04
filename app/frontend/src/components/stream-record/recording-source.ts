import {isStereoMix,type AudioInput} from '../meeting-ko/core';
export type StereoMixStatus={readonly state:'active'|'disabled'|'unplugged'|'unsupported';readonly id:string|null;readonly name:string|null};
export const deviceKey=(device:AudioInput)=>`${device.device_type}:${device.name}`;
export function systemAudioDevices(devices:readonly AudioInput[]){return [...devices.filter(device=>device.device_type==='Output'),...devices.filter(isStereoMix)];}
export function selectedSystemDevice(devices:readonly AudioInput[],key:string){return systemAudioDevices(devices).find(device=>deviceKey(device)===key);}
