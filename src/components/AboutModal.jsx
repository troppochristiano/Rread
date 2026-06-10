const content = {
  it: {
    title: "Info",
    close: "Chiudi",
    sections: [
      {
        heading: "Perché ho creato questo sito",
        body: "Volevo uno strumento text-to-speech illimitato e gratuito, che funzionasse interamente nel browser — senza account, senza abbonamenti, senza limiti di caratteri. Basta incollare il testo e ascoltarlo. La sintesi vocale usa la Web Speech API, integrata direttamente nel browser: le voci sono quelle del tuo sistema operativo, quindi tutto avviene sul dispositivo, senza inviare il testo a un server.",
      },
      {
        heading: "La libreria",
        body: [
          "Salva tutti i testi che vuoi nella libreria: puoi incollarli o importare file, anche PDF. Ogni testo conserva il punto di ascolto e l'avanzamento, così puoi chiudere la pagina e riprendere esattamente da dove avevi lasciato. Perfetta per usare il sito come narratore di libri ed ebook (ad esempio quelli scaricabili gratuitamente dal ",
          { text: "Progetto Gutenberg", href: "https://www.gutenberg.org/" },
          ").",
        ],
      },
      {
        heading: "Contattami",
        links: [
          {
            text: "christianbianchi007@gmail.com",
            href: "mailto:christianbianchi007@gmail.com",
          },
          { text: "@bian_chill", href: "https://www.instagram.com/bian_chill" },
        ],
      },
    ],
  },
  en: {
    title: "About",
    close: "Close",
    sections: [
      {
        heading: "Why I built this",
        body: "I wanted a completly free and unlimited text-to-speech tool that works entirely in the browser — no accounts, no subcriptions, no word limit. Just paste your text and listen. The speech is generated with the browser's built-in Web Speech API, using the voices from your operating system, so everything runs on your device — your text is never sent to a server.",
      },
      {
        heading: "The library",
        body: [
          "Save as many texts as you like in the library — paste them in or import files, including PDFs. Each text keeps its own listening position and progress, so you can close the page and resume exactly where you left off. Perfect for using the site as a narrator for books and ebooks (for example those available for free from ",
          { text: "Project Gutenberg", href: "https://www.gutenberg.org/" },
          ").",
        ],
      },
      {
        heading: "Contact",
        links: [
          {
            text: "christianbianchi007@gmail.com",
            href: "mailto:christianbianchi007@gmail.com",
          },
          { text: "@bian_chill", href: "https://www.instagram.com/bian_chill" },
        ],
      },
    ],
  },
};

export default function AboutModal({ locale, onClose }) {
  const c = content[locale] ?? content.en;
  return (
    <div className="about-overlay" onClick={onClose}>
      <div className="about-modal" onClick={(e) => e.stopPropagation()}>
        <div className="about-header">
          <span className="about-title">{c.title}</span>
          <button className="about-close" onClick={onClose}>
            ✕
          </button>
        </div>
        {c.sections.map((s) => (
          <div className="about-section" key={s.heading}>
            <p className="about-section-heading">{s.heading}</p>
            {s.links ? (
              <div className="about-section-links">
                {s.links.map((l) => (
                  <a
                    key={l.href}
                    className="about-link"
                    href={l.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {l.text}
                  </a>
                ))}
              </div>
            ) : (
              <p className="about-section-body">
                {Array.isArray(s.body)
                  ? s.body.map((part, i) =>
                      typeof part === "string" ? (
                        part
                      ) : (
                        <a
                          key={i}
                          className="about-link"
                          href={part.href}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {part.text}
                        </a>
                      ),
                    )
                  : s.body}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
