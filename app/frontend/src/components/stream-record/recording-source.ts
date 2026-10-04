import {isStereoMix,type AudioInput} from '../meeting-ko/core';
export const deviceKey=(device:AudioInput)=>`${device.device_type}:${device.name}`;
export function systemAudioDevices(devices:readonly AudioInput[]){const outputs=devices.filter(device=>device.device_type==='Output');return outputs.length?outputs:devices.filter(isStereoMix);}
export function selectedSystemDevice(devices:readonly AudioInput[],key:string){return systemAudioDevices(devices).find(device=>deviceKey(device)===key);}
