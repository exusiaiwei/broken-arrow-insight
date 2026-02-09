/**
 * 国际化管理
 */
import zh from './zh.js';
import en from './en.js';
import ru from './ru.js';
import ja from './ja.js';

const DICT = { zh, en, ru, ja };

let currentLang = 'zh';

/**
 * 设置当前语言
 * @param {string} lang - 'zh' | 'en' | 'ru' | 'ja'
 */
export function setLang(lang) {
  currentLang = lang;
  document.querySelectorAll('[id^="btn_lang_"]').forEach((btn) => {
    btn.classList.toggle('bg-cyan-600', btn.id === `btn_lang_${lang}`);
    btn.classList.toggle('text-white', btn.id === `btn_lang_${lang}`);
    btn.classList.toggle('text-slate-400', btn.id !== `btn_lang_${lang}`);
  });
  updateUIStrings();
}

/**
 * 获取当前语言
 * @returns {string}
 */
export function getLang() {
  return currentLang;
}

/**
 * 获取当前语言的翻译字典
 * @returns {Object}
 */
export function t() {
  return DICT[currentLang];
}

/**
 * 更新所有 UI 字符串（切换语言时调用）
 */
export function updateUIStrings() {
  const d = DICT[currentLang];

  // 标题 & 输入区
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.innerText = text; };
  const setAttr = (id, attr, val) => { const el = document.getElementById(id); if (el) el.setAttribute(attr, val); };

  set('lbl_title', d.title);
  set('lbl_subtitle', d.subtitle);
  setAttr('steamInput', 'placeholder', d.placeholder);
  set('btn_check', d.check);
  set('lbl_find_id_btn', d.find_id);
  set('lbl_find_match_btn', d.find_match);
  set('lbl_history_title', d.history_title);
  set('lbl_maggot_index_title', d.maggot_index_title);
  set('lbl_god_range', d.god_range);
  set('lbl_maggot_range', d.maggot_range);

  // 评分面板标签
  set('lbl_ref_impact', d.lbl_ref_impact);
  set('lbl_ref_dr', d.lbl_ref_dr);
  set('lbl_ref_tr', d.lbl_ref_tr);
  set('lbl_ref_or', d.lbl_ref_or);
  set('lbl_ref_wr', d.lbl_ref_wr);

  // 搜索模态框
  set('modal_title', d.modal_title);
  set('modal_btn_search', d.modal_btn_search);
  set('lbl_modal_pname', d.modal_pname);
  set('lbl_modal_pid', d.modal_pid);
  set('btn_use_id', d.modal_use_id);
  setAttr('modalSearchInput', 'placeholder', d.placeholder);

  // 对局搜索模态框
  set('modal_match_title', d.modal_match_title);
  setAttr('matchIdInput', 'placeholder', d.modal_match_input_ph);
  set('modal_match_btn_search', d.modal_match_btn_search);

  // 玩家详情模态框标签
  set('lbl_pd_kill', d.kill);
  set('lbl_pd_loss', d.loss);
  set('lbl_pd_obj', d.obj);
  set('lbl_pd_dmg_dealt', d.pd_dmg_dealt);
  set('lbl_pd_dmg_taken', d.pd_dmg_taken);
  set('lbl_pd_supply', d.pd_supply);
  set('lbl_pd_supply_ally', d.pd_supply_ally);
  set('lbl_pd_supply_give', d.pd_supply_give);
  set('lbl_pd_units', d.pd_units);
  set('lbl_pd_top_dmg', d.unit_dmg_title);
  set('lbl_pd_top_kill', d.unit_kill_title);
  set('lbl_pd_top_tank', d.unit_tank_title);
}
