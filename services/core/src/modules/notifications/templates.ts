/** Default message templates per language. Tenants override any of them in admin. {{var}} placeholders. */
import type { Lang } from "./providers.ts";
export const KINDS = ["gate", "dock", "task", "detention", "appointment", "password_reset"] as const;
export const DEFAULTS: Record<Lang, Record<(typeof KINDS)[number], { subject: string; text: string }>> = {
  en: {
    gate: { subject: "Checked in at {{site}}", text: "{{unit}} checked in ({{decision}}). Please wait for your door call." },
    dock: { subject: "Door {{door}}: unit placed", text: "{{unit}} is at door {{door}}." },
    task: { subject: "Move completed", text: "Move {{task}} completed." },
    detention: { subject: "Detention charge {{charge}}: {{state}}", text: "Charge {{charge}} is now {{state}}. Amounts are indicative until approved." },
    appointment: { subject: "Appointment {{ref}} {{status}}", text: "Appointment {{ref}} at {{site}} is {{status}} for {{time}}." },
    password_reset: { subject: "Reset your YMSNow password", text: "Your reset code is {{code}}. It expires in 30 minutes. If you did not ask for this, ignore this message." },
  },
  fr: {
    gate: { subject: "Enregistré à {{site}}", text: "{{unit}} enregistré ({{decision}}). Veuillez attendre l'appel de quai." },
    dock: { subject: "Quai {{door}} : unité placée", text: "{{unit}} est au quai {{door}}." },
    task: { subject: "Mouvement terminé", text: "Mouvement {{task}} terminé." },
    detention: { subject: "Frais de détention {{charge}} : {{state}}", text: "Les frais {{charge}} sont maintenant {{state}}. Montants indicatifs jusqu'à approbation." },
    appointment: { subject: "Rendez-vous {{ref}} {{status}}", text: "Le rendez-vous {{ref}} à {{site}} est {{status}} pour {{time}}." },
    password_reset: { subject: "Réinitialisez votre mot de passe YMSNow", text: "Votre code est {{code}}. Il expire dans 30 minutes. Si vous n'avez rien demandé, ignorez ce message." },
  },
  sw: {
    gate: { subject: "Umeingia {{site}}", text: "{{unit}} imesajiliwa ({{decision}}). Tafadhali subiri kuitwa mlangoni." },
    dock: { subject: "Mlango {{door}}: kontena imewekwa", text: "{{unit}} iko mlango {{door}}." },
    task: { subject: "Uhamisho umekamilika", text: "Uhamisho {{task}} umekamilika." },
    detention: { subject: "Ada ya ucheleweshaji {{charge}}: {{state}}", text: "Ada {{charge}} sasa ni {{state}}. Kiasi ni makadirio hadi kiidhinishwe." },
    appointment: { subject: "Miadi {{ref}} {{status}}", text: "Miadi {{ref}} {{site}} ni {{status}} saa {{time}}." },
    password_reset: { subject: "Weka upya nenosiri la YMSNow", text: "Nambari yako ni {{code}}. Inaisha baada ya dakika 30." },
  },
};
export const render = (s: string, vars: Record<string, unknown>) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] == null ? "" : String(vars[k])));
