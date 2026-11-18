// [emoji, keywords]
export const EMOJI = [
  ['😀', 'smile grin happy'], ['😂', 'laugh joy lol'], ['🙂', 'slight smile'], ['😉', 'wink'], ['😍', 'love heart eyes'], ['🤔', 'think hmm'], ['😎', 'cool sunglasses'], ['😢', 'sad cry'], ['😡', 'angry mad'], ['🥳', 'party celebrate'],
  ['👍', 'thumbs up yes ok like'], ['👎', 'thumbs down no'], ['👏', 'clap applause'], ['🙏', 'pray thanks please'], ['💪', 'strong muscle'], ['👀', 'eyes look'], ['🎉', 'tada party celebrate'], ['🔥', 'fire hot lit'], ['✨', 'sparkles magic new'], ['⭐', 'star favorite'],
  ['❤️', 'heart love red'], ['💙', 'blue heart'], ['💚', 'green heart'], ['💡', 'idea bulb light'], ['✅', 'check done success'], ['❌', 'cross no wrong'], ['⚠️', 'warning caution'], ['❗', 'important exclamation'], ['❓', 'question'], ['ℹ️', 'info information'],
  ['📌', 'pin'], ['📎', 'paperclip attach'], ['📝', 'memo note write'], ['📄', 'page document file'], ['📁', 'folder'], ['📂', 'open folder'], ['📚', 'books library docs'], ['📖', 'book read'], ['📅', 'calendar date'], ['⏰', 'alarm clock time'],
  ['📊', 'chart bar stats'], ['📈', 'chart up growth'], ['📉', 'chart down'], ['💰', 'money bag'], ['💳', 'credit card payment'], ['🏷️', 'tag label'], ['🔒', 'lock secure private'], ['🔑', 'key password'], ['🔔', 'bell notification'], ['🔍', 'search magnifier'],
  ['💻', 'laptop computer code'], ['🖥️', 'desktop monitor'], ['📱', 'phone mobile'], ['⌨️', 'keyboard'], ['🖱️', 'mouse'], ['🛠️', 'tools build wrench'], ['⚙️', 'gear settings'], ['🔧', 'wrench fix'], ['🧪', 'test experiment flask'], ['🔬', 'microscope research science'],
  ['🚀', 'rocket launch ship'], ['🐛', 'bug'], ['🧩', 'puzzle plugin'], ['🧠', 'brain mind'], ['🎯', 'target goal'], ['🏆', 'trophy win'], ['🏁', 'finish flag'], ['🚩', 'flag red'], ['🗺️', 'map roadmap'], ['🧭', 'compass'],
  ['🌐', 'globe web internet'], ['☁️', 'cloud'], ['⚡', 'lightning fast bolt'], ['🌱', 'seedling grow'], ['🌳', 'tree'], ['🌍', 'earth world'], ['☀️', 'sun'], ['🌙', 'moon night'], ['⛅', 'weather'], ['🌈', 'rainbow'],
  ['🍎', 'apple fruit'], ['☕', 'coffee'], ['🍕', 'pizza'], ['🍔', 'burger'], ['🍰', 'cake'], ['🍺', 'beer'], ['🏠', 'home house'], ['🏢', 'office building company'], ['🚗', 'car'], ['✈️', 'plane travel flight'],
  ['🎨', 'art palette design'], ['🎵', 'music note'], ['🎬', 'movie film'], ['📷', 'camera photo'], ['🎮', 'game controller'], ['⚽', 'soccer football'], ['🏀', 'basketball'], ['🐶', 'dog'], ['🐱', 'cat'], ['🦊', 'fox'],
  ['👤', 'user person'], ['👥', 'users people team'], ['🤝', 'handshake deal'], ['📣', 'megaphone announce'], ['💬', 'chat comment speech'], ['✉️', 'mail email envelope'], ['📞', 'phone call'], ['🔗', 'link chain'], ['📦', 'package box'], ['🗑️', 'trash delete'],
  ['➕', 'plus add'], ['➖', 'minus'], ['➡️', 'arrow right'], ['⬅️', 'arrow left'], ['⬆️', 'arrow up'], ['⬇️', 'arrow down'], ['🔄', 'refresh sync loop'], ['⏳', 'hourglass wait'], ['🆕', 'new'], ['💯', '100 perfect'],
];
export const searchEmoji = (q) => {
  const s = q.trim().toLowerCase();
  return (s ? EMOJI.filter(([, k]) => k.includes(s)) : EMOJI).map(([e, k]) => ({ emoji: e, name: k.split(' ')[0] }));
};
