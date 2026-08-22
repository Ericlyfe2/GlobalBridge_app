/**
 * Server-side notification text.
 *
 * Notification copy is localised *here*, not on the device, because a push
 * notification is rendered by the OS from the payload we send -- the app is not
 * running and cannot translate anything. Getting this wrong means a user who
 * set the product to Arabic receives English on their lock screen and the
 * correct language once they open the app, which reads as a bug in the
 * translation rather than in the delivery path.
 *
 * Fallback rule, applied per key rather than per locale: a missing string falls
 * back to English rather than rendering the key or an empty notification. A
 * half-translated locale is normal during a rollout; a blank lock screen is
 * not.
 */

export const SUPPORTED_LOCALES = [
  "en", "fr", "es", "de", "it", "pt", "ar",
  "zh", "ja", "ko", "ru", "tr", "hi", "sw",
] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const RTL_LOCALES = new Set<Locale>(["ar"]);

export function normalizeLocale(raw: string | null | undefined): Locale {
  if (!raw) return "en";
  // Accept "pt-BR", "zh-Hans" and friends -- match on the language subtag.
  const base = raw.toLowerCase().split(/[-_]/)[0];
  return (SUPPORTED_LOCALES as readonly string[]).includes(base) ? (base as Locale) : "en";
}

type Catalog = Record<string, string>;

/**
 * Only the strings the server itself emits live here. Screen copy belongs in
 * the app bundle; duplicating it would give two sources of truth for the same
 * sentence and guarantee they drift.
 */
const CATALOGS: Partial<Record<Locale, Catalog>> = {
  en: {
    "notification.message.title": "New message from {name}",
    "notification.deadline.title": "Deadline approaching",
    "notification.deadline.body": "{title} closes on {date}.",
    "notification.booking.title": "Session reminder",
    "notification.booking.body": "Your session with {name} starts at {time}.",
    "notification.security.title": "Security alert",
    "notification.document.title": "Document needs attention",
    "notification.opportunity.title": "New opportunity for you",
  },
  fr: {
    "notification.message.title": "Nouveau message de {name}",
    "notification.deadline.title": "Échéance proche",
    "notification.deadline.body": "{title} se termine le {date}.",
    "notification.booking.title": "Rappel de session",
    "notification.booking.body": "Votre session avec {name} commence à {time}.",
    "notification.security.title": "Alerte de sécurité",
    "notification.document.title": "Document à vérifier",
    "notification.opportunity.title": "Nouvelle opportunité pour vous",
  },
  es: {
    "notification.message.title": "Nuevo mensaje de {name}",
    "notification.deadline.title": "Fecha límite próxima",
    "notification.deadline.body": "{title} cierra el {date}.",
    "notification.booking.title": "Recordatorio de sesión",
    "notification.booking.body": "Tu sesión con {name} empieza a las {time}.",
    "notification.security.title": "Alerta de seguridad",
    "notification.document.title": "Un documento necesita atención",
    "notification.opportunity.title": "Nueva oportunidad para ti",
  },
  ar: {
    "notification.message.title": "رسالة جديدة من {name}",
    "notification.deadline.title": "اقتراب الموعد النهائي",
    "notification.deadline.body": "ينتهي {title} في {date}.",
    "notification.booking.title": "تذكير بالجلسة",
    "notification.booking.body": "تبدأ جلستك مع {name} في {time}.",
    "notification.security.title": "تنبيه أمني",
    "notification.document.title": "مستند يحتاج إلى مراجعة",
    "notification.opportunity.title": "فرصة جديدة لك",
  },
};

/**
 * Interpolation is positional-by-name and does not recurse: a value that itself
 * contains "{name}" is inserted literally. User-supplied names end up in these
 * strings, so a template that could expand its own substitutions would let a
 * display name rewrite the sentence around it.
 */
export function t(locale: Locale, key: string, vars: Record<string, string> = {}): string {
  const template = CATALOGS[locale]?.[key] ?? CATALOGS.en?.[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : whole,
  );
}

/** True when the locale has its own entry for `key` rather than falling back. */
export function hasTranslation(locale: Locale, key: string): boolean {
  return Boolean(CATALOGS[locale]?.[key]);
}
