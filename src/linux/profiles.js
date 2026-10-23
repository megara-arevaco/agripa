(function (root) {
  const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const defaultQuestions = {
    es: ['Dame una pista sin spoilers.', 'Explica esta mecánica y cómo usarla.', 'Compara estos objetos y sus ventajas.'],
    en: ['Give me a hint without spoilers.', 'Explain this mechanic and how to use it.', 'Compare these items and their trade-offs.']
  };
  function content(value = {}, fallbackName = '', language = 'es') {
    const answerLanguage = ['es', 'en'].includes(value.answerLanguage) ? value.answerLanguage : language;
    return {
      game: clean(value.game, 120) || clean(fallbackName, 120),
      answerLanguage,
      spoilers: ['none', 'hints', 'full'].includes(value.spoilers) ? value.spoilers : 'none',
      instructions: clean(value.instructions, 3000), progress: clean(value.progress, 1500),
      quickPrompts: Array.isArray(value.quickPrompts) ? value.quickPrompts.slice(0, 10).map(p => clean(p, 500)).filter(Boolean) : [...defaultQuestions[answerLanguage]]
    };
  }
  function prompt(profile, question = '') {
    const p = content(profile, profile?.name);
    const lines = p.answerLanguage === 'en' ? [
      p.game && `I am playing ${p.game}.`, 'Please reply in English.',
      { none: 'Avoid story, character and puzzle spoilers. Give hints before solutions and ask before revealing more.', hints: 'Start with hints. Reveal the exact solution only when I explicitly ask for it.', full: 'Spoilers and complete solutions are allowed.' }[p.spoilers],
      p.progress && `My current progress: ${p.progress}`, p.instructions && `My preferences: ${p.instructions}`,
      'If the screenshot or question is ambiguous, ask for clarification. If you are unsure, say so.'
    ] : [
      p.game && `Estoy jugando a ${p.game}.`, 'Responde en español.',
      { none: 'Evita spoilers de historia, personajes y puzles. Da pistas antes que soluciones y pregunta antes de revelar más.', hints: 'Empieza con pistas. Revela la solución exacta solo cuando te la pida expresamente.', full: 'Puedes incluir spoilers y soluciones completas.' }[p.spoilers],
      p.progress && `Mi progreso actual: ${p.progress}`, p.instructions && `Mis preferencias: ${p.instructions}`,
      'Si la captura o la pregunta son ambiguas, pide una aclaración. Si no estás seguro, dilo.'
    ];
    if (clean(question, 500)) lines.push('', clean(question, 500));
    return lines.filter(line => line !== false && line !== undefined && line !== null).join('\n');
  }
  const api = { content, prompt, defaultQuestions };
  if (typeof module !== 'undefined') module.exports = api;
  else root.AgripaProfiles = api;
})(globalThis);
