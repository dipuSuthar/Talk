// Built-in sticker packs. The server only stores { pack, id }, so packs can grow without migrations.
export const STICKER_PACKS = [
  {
    id: "classic",
    name: "Classic",
    icon: "😄",
    stickers: [
      { id: "party", emoji: "🥳", label: "Party!", bg: "#f59e0b" },
      { id: "lol", emoji: "😂", label: "LOL", bg: "#facc15" },
      { id: "love", emoji: "😍", label: "Love it", bg: "#ec4899" },
      { id: "cool", emoji: "😎", label: "Cool", bg: "#0ea5e9" },
      { id: "wow", emoji: "🤯", label: "Mind blown", bg: "#8b5cf6" },
      { id: "cry", emoji: "😭", label: "Sob", bg: "#38bdf8" },
      { id: "think", emoji: "🤔", label: "Hmm…", bg: "#a78bfa" },
      { id: "sleepy", emoji: "😴", label: "Sleepy", bg: "#6366f1" },
      { id: "angry", emoji: "😡", label: "Grr", bg: "#ef4444" },
      { id: "hug", emoji: "🤗", label: "Hugs", bg: "#fb923c" },
      { id: "ok", emoji: "👌", label: "Perfect", bg: "#22c55e" },
      { id: "thanks", emoji: "🙏", label: "Thanks", bg: "#14b8a6" },
    ],
  },
  {
    id: "vibes",
    name: "Vibes",
    icon: "🔥",
    stickers: [
      { id: "fire", emoji: "🔥", label: "Fire", bg: "#f97316" },
      { id: "hundred", emoji: "💯", label: "100", bg: "#ef4444" },
      { id: "rocket", emoji: "🚀", label: "Ship it", bg: "#6366f1" },
      { id: "pizza", emoji: "🍕", label: "Pizza?", bg: "#f59e0b" },
      { id: "coffee", emoji: "☕", label: "Coffee", bg: "#a16207" },
      { id: "star", emoji: "⭐", label: "Star", bg: "#eab308" },
      { id: "heart", emoji: "💖", label: "Aww", bg: "#ec4899" },
      { id: "ghost", emoji: "👻", label: "Boo", bg: "#64748b" },
      { id: "cake", emoji: "🎂", label: "Happy B-day", bg: "#f472b6" },
      { id: "clap", emoji: "👏", label: "Bravo", bg: "#f59e0b" },
      { id: "music", emoji: "🎧", label: "Vibing", bg: "#8b5cf6" },
      { id: "moon", emoji: "🌙", label: "Night!", bg: "#334155" },
    ],
  },
];

export const findSticker = (pack, id) => STICKER_PACKS.find((p) => p.id === pack)?.stickers.find((s) => s.id === id);
