import { createTranslator, startLocalizer, type Dictionary } from './engine';
import { koBaseDictionary, koPatterns } from './dictionary';
import { koMessageDictionary } from './dictionary-messages';
import { koExtraDictionary } from './dictionary-extra';
import { koRuntimeDictionary } from './dictionary-runtime';
import { koObservedDictionary } from './dictionary-observed';
import { koLanguageDictionary } from './dictionary-languages';

export const koDictionary: Dictionary = {
  ...koBaseDictionary,
  ...koMessageDictionary,
  ...koExtraDictionary,
  ...koRuntimeDictionary,
  ...koObservedDictionary,
  ...koLanguageDictionary,
};

export function startKoreanLocale(): () => void {
  const translate = createTranslator(koDictionary, koPatterns);
  document.documentElement.lang = 'ko';
  const translatedTitle = translate(document.title);
  if (translatedTitle) document.title = translatedTitle;
  return startLocalizer(translate);
}
