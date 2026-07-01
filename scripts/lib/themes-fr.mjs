// Plain-French, general-audience labels and explanations for the 17 RAWeb
// 1.1 themes. These are deliberately NOT the official RGAA/RAWeb wording —
// they're simplified for a lay audience, per the project's requirement that
// questions avoid accessibility-specialist jargon. The theme *numbers* are
// only used internally (to group criterion codes like "3.2") and are never
// shown in the UI.
export const THEMES_FR = {
  "1": {
    label: "Images et visuels",
    explanation:
      "Les images qui apportent une information doivent avoir une description textuelle, utile aux personnes qui ne peuvent pas voir l'image.",
  },
  "2": {
    label: "Cadres intégrés (iframes)",
    explanation:
      "Les cadres intégrés dans une page (vidéos, cartes, formulaires externes) doivent être clairement identifiés pour qu'on comprenne à quoi ils servent.",
  },
  "3": {
    label: "Contrastes et couleurs",
    explanation:
      "Le texte doit rester lisible pour les personnes malvoyantes ou daltoniennes : il faut un contraste suffisant avec l'arrière-plan, et l'information ne doit pas reposer sur la seule couleur.",
  },
  "4": {
    label: "Vidéos et sons",
    explanation:
      "Les vidéos et contenus audio doivent proposer des sous-titres, une transcription ou une audiodescription pour rester compréhensibles par tous.",
  },
  "5": {
    label: "Tableaux de données",
    explanation:
      "Les tableaux de données doivent être structurés correctement pour qu'un lecteur d'écran puisse les annoncer de façon compréhensible.",
  },
  "6": {
    label: "Liens",
    explanation:
      "Chaque lien doit avoir un intitulé clair qui permet de comprendre où il mène, même hors de son contexte (éviter par exemple \"cliquez ici\").",
  },
  "7": {
    label: "Éléments interactifs et animations",
    explanation:
      "Les éléments dynamiques (menus, boutons, animations) doivent rester utilisables au clavier et compréhensibles par les technologies d'assistance.",
  },
  "8": {
    label: "Informations obligatoires de la page",
    explanation:
      "Chaque page doit comporter certains éléments essentiels (langue déclarée, titre pertinent, etc.) qui aident à s'y retrouver.",
  },
  "9": {
    label: "Structure du contenu",
    explanation:
      "Le contenu doit être organisé avec des titres et une hiérarchie claire, ce qui permet de naviguer rapidement, notamment avec un lecteur d'écran.",
  },
  "10": {
    label: "Présentation visuelle",
    explanation:
      "La mise en page (tailles de texte, espacements, alignement) doit rester claire et adaptable, y compris quand on agrandit l'affichage.",
  },
  "11": {
    label: "Formulaires",
    explanation:
      "Les formulaires (contact, connexion, démarches en ligne) doivent avoir des champs bien identifiés, des messages d'erreur clairs, et rester utilisables au clavier.",
  },
  "12": {
    label: "Navigation et menus",
    explanation:
      "Un site doit proposer plusieurs façons de circuler (menu, recherche, plan du site) et permettre de se repérer facilement d'une page à l'autre.",
  },
  "13": {
    label: "Documents à télécharger",
    explanation:
      "Les documents proposés en téléchargement (PDF, Word...) doivent eux aussi être accessibles, avec une structure claire et un texte reconnaissable.",
  },
  "14": {
    label: "Aide et fonctionnalités d'accessibilité",
    explanation:
      "Un site accessible peut proposer une aide ou des réglages spécifiques (taille du texte, contraste) pour faciliter son utilisation.",
  },
  "15": {
    label: "Outils de contribution en ligne",
    explanation:
      "Quand un site permet de rédiger du contenu en ligne (espace membre, forum), cet outil de rédaction doit lui-même rester accessible.",
  },
  "16": {
    label: "Contact et assistance",
    explanation:
      "Les moyens de contacter le site (formulaire, téléphone, chat) doivent être accessibles à tous les usagers, y compris ceux utilisant des aides techniques.",
  },
  "17": {
    label: "Communication en direct (chat, visio)",
    explanation:
      "Les outils de communication en temps réel (chat en direct, visioconférence) doivent être utilisables par les personnes en situation de handicap.",
  },
};

// Themes whose presence/absence of issues a lay visitor could plausibly
// notice just by looking at the live site or its screenshot (used by the
// true/false generator, which should feel answerable, not purely trivia).
export const VISUALLY_INSPECTABLE_THEMES = ["3", "6", "10", "11", "12"];

export function themeLabel(number) {
  return THEMES_FR[number]?.label ?? `Thème ${number}`;
}

export function themeExplanation(number) {
  return THEMES_FR[number]?.explanation ?? "";
}
