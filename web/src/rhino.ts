/** Tank the rhino, FormUp's mascot (from the design team's spec). Moods: ready, cheer, worried, stern. */
export type Mood = 'ready' | 'cheer' | 'worried' | 'stern';
export function rhino(mood: Mood): string {
  const dark = '#1A1E28';
  let eyes: string, brows = "", mouth: string, arms = "";
  const dot = (x: number) => `<circle cx="${x}" cy="55" r="4.6" fill="${dark}"/><circle cx="${x + 1.6}" cy="53.4" r="1.5" fill="#fff"/>`;
  if (mood === 'cheer') {
    eyes = `<path d="M38 57q6-8 12 0M70 57q6-8 12 0" fill="none" stroke="${dark}" stroke-width="3.6" stroke-linecap="round"/>`;
    mouth = `<path d="M49 85 q11 14 22 0 z" fill="${dark}"/><path d="M54 90 q6 4 12 0 q-6 -3 -12 0z" fill="#E7848C"/>`;
    arms = `<path d="M28 102 L12 78" stroke="#8591A7" stroke-width="13" stroke-linecap="round"/><path d="M92 102 L108 78" stroke="#8591A7" stroke-width="13" stroke-linecap="round"/><circle cx="11" cy="75" r="8" fill="#9AA5BA"/><circle cx="109" cy="75" r="8" fill="#9AA5BA"/>`;
  } else {
    eyes = dot(43) + dot(75);
    if (mood === 'worried') { brows = `<path d="M36 47 L49 43M84 47 L71 43" stroke="${dark}" stroke-width="3.4" stroke-linecap="round"/>`; mouth = `<path d="M53 91 q7 -5 14 0" fill="none" stroke="${dark}" stroke-width="3" stroke-linecap="round"/>`; }
    else if (mood === 'stern') { brows = `<path d="M36 44 L50 48.5M84 44 L70 48.5" stroke="${dark}" stroke-width="3.8" stroke-linecap="round"/>`; mouth = `<path d="M53 90 h14" stroke="${dark}" stroke-width="3" stroke-linecap="round"/>`; }
    else { mouth = `<path d="M51 87 q9 7 18 0" fill="none" stroke="${dark}" stroke-width="3" stroke-linecap="round"/>`; }
  }
  return `<svg viewBox="0 0 120 120" role="img" aria-label="Tank the rhino, ${mood}">
    ${arms}
    <ellipse cx="60" cy="116" rx="40" ry="24" fill="#8591A7"/>
    <ellipse cx="60" cy="120" rx="22" ry="14" fill="#B6BFD0"/>
    <g transform="rotate(-28 31 30)"><ellipse cx="31" cy="30" rx="8" ry="12" fill="#8591A7"/><ellipse cx="31" cy="31" rx="4" ry="7" fill="#E7A3A8"/></g>
    <g transform="rotate(28 89 30)"><ellipse cx="89" cy="30" rx="8" ry="12" fill="#8591A7"/><ellipse cx="89" cy="31" rx="4" ry="7" fill="#E7A3A8"/></g>
    <ellipse cx="60" cy="57" rx="36" ry="31" fill="#9AA5BA"/>
    <path d="M26 44 Q60 27 94 44" fill="none" stroke="#FF6B2C" stroke-width="9" stroke-linecap="round"/>
    <path d="M28 41.5 Q60 25 92 41.5" fill="none" stroke="#FFB08C" stroke-width="1.6" stroke-linecap="round" opacity=".8"/>
    <path d="M93 43 l9 7 M93 43 l11 -1" stroke="#FF6B2C" stroke-width="5" stroke-linecap="round"/>
    <ellipse cx="36" cy="68" rx="6" ry="3.5" fill="#E7A3A8" opacity=".55"/><ellipse cx="84" cy="68" rx="6" ry="3.5" fill="#E7A3A8" opacity=".55"/>
    <ellipse cx="60" cy="80" rx="25" ry="17" fill="#B6BFD0"/>
    <path d="M52.5 70 C53.5 52 57.5 37 66 24 C63.5 40 65.5 55 67.5 70 Z" fill="#F4E8CF"/>
    <path d="M60 70 C60.5 56 62.5 44 66 24" fill="none" stroke="#DCCDAA" stroke-width="1.5"/>
    ${eyes}${brows}
    <ellipse cx="52" cy="78" rx="2.6" ry="3.4" fill="#5E6779"/><ellipse cx="68" cy="78" rx="2.6" ry="3.4" fill="#5E6779"/>
    ${mouth}
  </svg>`;
}
