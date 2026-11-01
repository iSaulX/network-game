export interface GameResultSummary {
  readonly humanWon: boolean;
  readonly title: string;
  readonly description: string;
  readonly image: "/game-results/win.png" | "/game-results/loser.png";
  readonly alt: string;
}

/**
 * Builds the Spanish copy and artwork for the post-game result screen from the
 * engine's winner. The human sees the trophy only when their own seat won;
 * otherwise the winner's name is shown with the crying illustration.
 */
export function getGameResultSummary(
  humanWon: boolean,
  winnerName: string,
): GameResultSummary {
  if (humanWon) {
    return {
      humanWon: true,
      title: "¡Has ganado!",
      description:
        "Tus cuatro fichas han llegado a la meta. ¡Buen juego!",
      image: "/game-results/win.png",
      alt: "Trofeo de victoria",
    };
  }

  const winner = winnerName.trim() || "El rival";

  return {
    humanWon: false,
    title: "Has perdido",
    description: `${winner} ha ganado la partida. ¡La próxima será tuya!`,
    image: "/game-results/loser.png",
    alt: "Cara triste de derrota",
  };
}
