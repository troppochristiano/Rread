const content = {
  it: {
    title: "Info",
    close: "Chiudi",
    sections: [
      {
        heading: "Perché ho creato questo sito",
        body: "Volevo uno strumento text-to-speech illimitato e gratuito, che funzionasse interamente nel browser — senza account, senza abbonamenti, senza limiti di caratteri. Basta incollare il testo e ascoltarlo.",
      },
      {
        heading: "A cosa serve",
        body: "Leggere articoli, post, documenti e libri a mani libere. Correggere i propri testi ascoltandoli. Studiare lingue sentendo come suonano le parole a velocità o voci diverse.",
      },
      {
        heading: "Salvataggio automatico",
        body: [
          "Il testo incollato e il punto di ascolto vengono salvati automaticamente nel browser. Puoi chiudere la pagina e riprendere esattamente da dove avevi lasciato — perfetto per usarlo come narratore di libri in formato testo (ad esempio quelli scaricabili gratuitamente dal ",
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
        body: "I wanted a completly free and unlimited text-to-speech tool that works entirely in the browser — no accounts, no subcriptions, no word limit. Just paste your text and listen.",
      },
      {
        heading: "What you can use it for",
        body: "Reading articles, blog posts, documents or books hands-free. Proofreading your own writing by listening to it. Language learning — hear how text sounds in different voices or at different speeds.",
      },
      {
        heading: "Automatic saving",
        body: [
          "Your pasted text and listening position are saved automatically in the browser. You can close the page and resume exactly where you left off — perfect for using it as a narrator for plain-text books (for example those available for free from ",
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
