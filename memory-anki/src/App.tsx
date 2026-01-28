import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BlockMath, InlineMath } from "react-katex";
import "katex/dist/katex.min.css";
import "./App.css";

type BaseCard = {
  id: string;
  deck: string;
  question: string;
  answer: string;
  explanation?: string;
  nextReviewAt: string;
  intervalDays: number;
  createdAt: string;
  lastReviewedAt?: string;
  reviewCount: number;
};

type BasicCard = BaseCard & {
  type: "basic";
};

type ChoiceCard = BaseCard & {
  type: "choice";
  choices: string[];
};

type Card = BasicCard | ChoiceCard;

type ReviewGrade = "again" | "hard" | "good" | "easy";
type TestStatus = "idle" | "in_progress" | "finished";

type TestResult = {
  cardId: string;
  selected: string;
  isCorrect: boolean;
};

const STORAGE_KEY = "memory-anki.cards.v1";
const DECKS_KEY = "memory-anki.decks.v1";
const DEFAULT_DECK = "General";

const formatDateTime = (date: Date) =>
  new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);

const formatDateOnly = (date: Date) =>
  new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
  }).format(date);

const parseCsvLine = (line: string) =>
  line
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((value) => value.trim().replace(/^"|"$/g, ""));

const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const reviewAdjustments: Record<ReviewGrade, number> = {
  again: 0,
  hard: 1,
  good: 2,
  easy: 4,
};

const shuffle = <T,>(items: T[]) => {
  const list = [...items];
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
};

const renderTextWithLatex = (text: string) => {
  const pattern = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\$[^$\n]+\$)/g;
  const parts = text.split(pattern).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("\\[") && part.endsWith("\\]")) {
      return (
        <div key={`math-block-${index}`} className="math-block">
          <BlockMath math={part.slice(2, -2)} />
        </div>
      );
    }
    if (part.startsWith("$$") && part.endsWith("$$")) {
      return (
        <span key={`math-inline-${index}`} className="math-inline">
          <InlineMath math={part.slice(2, -2)} />
        </span>
      );
    }
    if (part.startsWith("$") && part.endsWith("$")) {
      return (
        <span key={`math-inline-${index}`} className="math-inline">
          <InlineMath math={part.slice(1, -1)} />
        </span>
      );
    }
    return (
      <span key={`text-${index}`} className="text-chunk">
        {part}
      </span>
    );
  });
};

function App() {
  const [activeTab, setActiveTab] = useState<
    "import" | "cards" | "review" | "test"
  >(
    "import"
  );
  const [cards, setCards] = useState<Card[]>([]);
  const [decks, setDecks] = useState<string[]>([DEFAULT_DECK]);
  const [activeDeck, setActiveDeck] = useState(DEFAULT_DECK);
  const [newDeckName, setNewDeckName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [editingCard, setEditingCard] = useState<Card | null>(null);
  const [editDraft, setEditDraft] = useState({
    question: "",
    answer: "",
    explanation: "",
    choicesText: "",
  });
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testCards, setTestCards] = useState<ChoiceCard[]>([]);
  const [testIndex, setTestIndex] = useState(0);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [testSelection, setTestSelection] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const payload = await invoke<{
          cards?: Card[];
          decks?: string[];
        }>("load_storage");

        if (payload?.cards) {
          setCards(payload.cards as Card[]);
        } else {
          const stored = localStorage.getItem(STORAGE_KEY);
          if (stored) {
            setCards(JSON.parse(stored));
          }
        }

        if (payload?.decks && payload.decks.length > 0) {
          setDecks(payload.decks);
        } else {
          const storedDecks = localStorage.getItem(DECKS_KEY);
          if (storedDecks) {
            const parsed = JSON.parse(storedDecks);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setDecks(parsed);
            }
          }
        }
      } catch (error) {
        console.warn("Failed to load storage", error);
      }
    };

    load();
  }, []);

  useEffect(() => {
    const save = async () => {
      try {
        await invoke("save_storage", {
          payload: {
            cards,
            decks,
          },
        });
      } catch (error) {
        console.warn("Failed to save storage", error);
      }
    };

    save();
  }, [cards, decks]);

  useEffect(() => {
    if (editingCard) {
      document.body.classList.add("modal-open");
    } else {
      document.body.classList.remove("modal-open");
    }
    return () => {
      document.body.classList.remove("modal-open");
    };
  }, [editingCard]);

  useEffect(() => {
    if (!decks.includes(activeDeck)) {
      setActiveDeck(DEFAULT_DECK);
    }
  }, [activeDeck, decks]);

  const dueCards = useMemo(() => {
    const today = startOfToday();
    return cards.filter(
      (card) =>
        card.deck === activeDeck && new Date(card.nextReviewAt) <= today
    );
  }, [activeDeck, cards]);

  const pendingCards = useMemo(() => {
    const today = startOfToday();
    return cards.filter(
      (card) => card.deck === activeDeck && new Date(card.nextReviewAt) > today
    );
  }, [activeDeck, cards]);

  const currentReviewCard = dueCards[reviewIndex];

  const handleImport = () => {
    setImportError(null);
    if (!csvText.trim()) {
      setImportError("CSVが空です。問題と回答を入力してください。");
      return;
    }

    const lines = csvText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const nextCards: Card[] = [];
    const now = new Date();
    const today = startOfToday();

    lines.forEach((line, index) => {
      const [deckRaw, typeRaw, question, answer, choicesRaw, explanationRaw] =
        parseCsvLine(line);
      const deck = deckRaw?.trim() || activeDeck || DEFAULT_DECK;
      const type = typeRaw?.toLowerCase();
      const explanation = explanationRaw?.trim();
      if (!question || !answer) {
        throw new Error(`行 ${index + 1} に問題と回答がありません。`);
      }

      if (type === "choice") {
        const choices = choicesRaw
          ? choicesRaw.split("|").map((choice) => choice.trim()).filter(Boolean)
          : [];
        if (choices.length < 2) {
          throw new Error(`行 ${index + 1} の選択肢が不足しています。`);
        }
        nextCards.push({
          id: `${Date.now()}-${index}`,
          deck,
          type: "choice",
          question,
          answer,
          choices,
          explanation,
          nextReviewAt: today.toISOString(),
          intervalDays: 1,
          createdAt: now.toISOString(),
          reviewCount: 0,
        });
        return;
      }

      nextCards.push({
        id: `${Date.now()}-${index}`,
        deck,
        type: "basic",
        question,
        answer,
        explanation,
        nextReviewAt: today.toISOString(),
        intervalDays: 1,
        createdAt: now.toISOString(),
        reviewCount: 0,
      });
    });

    setCards((prev) => [...prev, ...nextCards]);
    setCsvText("");
    setActiveTab("review");
    setReviewIndex(0);
    setShowAnswer(false);
    setSelectedChoice(null);
  };

  const handleImportSafe = () => {
    try {
      handleImport();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "取り込みに失敗しました。");
    }
  };

  const updateCardReview = (card: Card, grade: ReviewGrade) => {
    const today = startOfToday();
    const adjustment = reviewAdjustments[grade];
    const nextInterval = grade === "again" ? 1 : card.intervalDays + adjustment;
    const nextReviewAt = addDays(today, nextInterval);

    setCards((prev) =>
      prev.map((item) =>
        item.id === card.id
          ? {
              ...item,
              intervalDays: nextInterval,
              lastReviewedAt: new Date().toISOString(),
              nextReviewAt: nextReviewAt.toISOString(),
              reviewCount: item.reviewCount + 1,
            }
          : item
      )
    );
  };

  const handleReview = (grade: ReviewGrade) => {
    if (!currentReviewCard) return;
    updateCardReview(currentReviewCard, grade);
    setShowAnswer(false);
    setSelectedChoice(null);
    setReviewIndex((prev) => Math.min(prev + 1, Math.max(dueCards.length - 1, 0)));
  };

  const resetReviewSession = () => {
    setReviewIndex(0);
    setShowAnswer(false);
    setSelectedChoice(null);
  };

  const handleChoiceSelect = (choice: string) => {
    setSelectedChoice(choice);
    setShowAnswer(true);
  };

  const handleCreateDeck = () => {
    if (!newDeckName.trim()) return;
    const trimmed = newDeckName.trim();
    setDecks((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed]));
    setActiveDeck(trimmed);
    setNewDeckName("");
  };

  const handleDeleteCard = (cardId: string) => {
    if (!window.confirm("このカードを削除しますか？")) return;
    setCards((prev) => prev.filter((card) => card.id !== cardId));
  };

  const handleDeleteDeck = (deckName: string) => {
    if (deckName === DEFAULT_DECK) {
      window.alert("General デッキは削除できません。");
      return;
    }
    const deckCards = cards.filter((card) => card.deck === deckName).length;
    const message = `デッキ「${deckName}」と、その中のカード ${deckCards} 枚を削除します。よろしいですか？`;
    if (!window.confirm(message)) return;

    setCards((prev) => prev.filter((card) => card.deck !== deckName));
    setDecks((prev) => prev.filter((deck) => deck !== deckName));
    setActiveDeck((prev) => {
      if (prev !== deckName) return prev;
      const remaining = decks.filter((deck) => deck !== deckName);
      return remaining[0] ?? DEFAULT_DECK;
    });
  };

  const openEditModal = (card: Card) => {
    setEditingCard(card);
    setEditDraft({
      question: card.question,
      answer: card.answer,
      explanation: card.explanation ?? "",
      choicesText:
        card.type === "choice" ? card.choices.join("\n") : "",
    });
  };

  const closeEditModal = () => {
    setEditingCard(null);
  };

  const handleEditSave = () => {
    if (!editingCard) return;
    const trimmedQuestion = editDraft.question.trim();
    const trimmedAnswer = editDraft.answer.trim();
    if (!trimmedQuestion || !trimmedAnswer) {
      window.alert("問題と正解は必須です。");
      return;
    }
    setCards((prev) =>
      prev.map((card) => {
        if (card.id !== editingCard.id) return card;
        if (card.type === "choice") {
          const choices = editDraft.choicesText
            .split(/\r?\n/)
            .map((choice) => choice.trim())
            .filter(Boolean);
          if (choices.length < 2) {
            window.alert("選択肢は2つ以上必要です。");
            return card;
          }
          return {
            ...card,
            question: trimmedQuestion,
            answer: trimmedAnswer,
            explanation: editDraft.explanation.trim(),
            choices,
          };
        }
        return {
          ...card,
          question: trimmedQuestion,
          answer: trimmedAnswer,
          explanation: editDraft.explanation.trim(),
        };
      })
    );
    closeEditModal();
  };

  const resetTest = () => {
    setTestStatus("idle");
    setTestCards([]);
    setTestIndex(0);
    setTestResults([]);
    setTestSelection(null);
  };

  const startTest = (sourceCards: ChoiceCard[]) => {
    if (sourceCards.length === 0) {
      window.alert("選択式カードがありません。");
      return;
    }
    setTestCards(shuffle(sourceCards));
    setTestIndex(0);
    setTestResults([]);
    setTestSelection(null);
    setTestStatus("in_progress");
  };

  const handleTestSelect = (choice: string) => {
    if (testStatus !== "in_progress") return;
    if (testSelection) return;
    const current = testCards[testIndex];
    if (!current) return;
    const isCorrect = choice === current.answer;
    setTestSelection(choice);
    setTestResults((prev) => [
      ...prev,
      { cardId: current.id, selected: choice, isCorrect },
    ]);
  };

  const goToNextTestCard = () => {
    if (testStatus !== "in_progress") return;
    if (!testSelection) {
      window.alert("選択肢を選んでください。");
      return;
    }
    const nextIndex = testIndex + 1;
    if (nextIndex >= testCards.length) {
      setTestStatus("finished");
      return;
    }
    setTestIndex(nextIndex);
    setTestSelection(null);
  };

  const startRetryWrongOnly = () => {
    const wrongIds = new Set(
      testResults.filter((result) => !result.isCorrect).map((r) => r.cardId)
    );
    const wrongCards = testCards.filter((card) => wrongIds.has(card.id));
    startTest(wrongCards);
  };

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <p className="app__eyebrow">Memory Anki</p>
          <h1>学習カード管理</h1>
          <p className="app__subtitle">CSV取り込みと基本SRSで復習を進めましょう。</p>
        </div>
        <div className="app__stats">
          <div>
            <span className="app__stat-label">未復習</span>
            <span className="app__stat-value">{dueCards.length} 枚</span>
          </div>
          <div>
            <span className="app__stat-label">保留中</span>
            <span className="app__stat-value">{pendingCards.length} 枚</span>
          </div>
          <div>
            <span className="app__stat-label">合計</span>
            <span className="app__stat-value">{cards.length} 枚</span>
          </div>
        </div>
      </header>

      <section className="panel deck-panel">
        <div className="deck-panel__info">
          <h2>デッキ選択</h2>
          <p>科目ごとにカードを分けて管理できます。</p>
        </div>
        <div className="deck-panel__controls">
          <select
            value={activeDeck}
            onChange={(event) => setActiveDeck(event.target.value)}
          >
            {decks.map((deck) => (
              <option key={deck} value={deck}>
                {deck}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="danger"
            onClick={() => handleDeleteDeck(activeDeck)}
            disabled={activeDeck === DEFAULT_DECK}
          >
            デッキ削除
          </button>
          <div className="deck-panel__new">
            <input
              type="text"
              value={newDeckName}
              onChange={(event) => setNewDeckName(event.target.value)}
              placeholder="新しいデッキ名"
            />
            <button type="button" onClick={handleCreateDeck}>
              追加
            </button>
          </div>
        </div>
      </section>

      <nav className="app__tabs">
        <button
          type="button"
          className={activeTab === "import" ? "is-active" : ""}
          onClick={() => setActiveTab("import")}
        >
          取り込み
        </button>
        <button
          type="button"
          className={activeTab === "cards" ? "is-active" : ""}
          onClick={() => setActiveTab("cards")}
        >
          カード一覧
        </button>
        <button
          type="button"
          className={activeTab === "review" ? "is-active" : ""}
          onClick={() => setActiveTab("review")}
        >
          復習
        </button>
        <button
          type="button"
          className={activeTab === "test" ? "is-active" : ""}
          onClick={() => setActiveTab("test")}
        >
          テスト
        </button>
      </nav>

      <main className="app__content">
        {activeTab === "import" && (
          <section className="panel">
            <h2>CSV取り込み</h2>
            <p>
              1行にCSVで入力してください。基本は
              <code>デッキ,basic,問題,回答,,解説</code>、選択式は
              <code>デッキ,choice,問題,正解,選択肢1|選択肢2|選択肢3,解説</code>。
            </p>
            <textarea
              value={csvText}
              onChange={(event) => setCsvText(event.target.value)}
              placeholder="例: 好きな色は?,青"
              rows={8}
            />
            {importError && <p className="error">{importError}</p>}
            <button type="button" className="primary" onClick={handleImportSafe}>
              取り込み
            </button>
          </section>
        )}

        {activeTab === "cards" && (
          <section className="panel">
            <h2>カード一覧</h2>
            {cards.length === 0 ? (
              <p className="empty">まだカードがありません。CSV取り込みから追加してください。</p>
            ) : (
              <div className="card-list">
                {cards
                  .filter((card) => card.deck === activeDeck)
                  .map((card) => (
                  <article key={card.id} className="card-item">
                    <div>
                      <div className="card-type">
                        {card.type === "choice" ? "選択" : "基本"}
                      </div>
                      <h3>{renderTextWithLatex(card.question)}</h3>
                      <p className="card-answer">{renderTextWithLatex(card.answer)}</p>
                      {card.type === "choice" && (
                        <ul className="choice-list">
                          {card.choices.map((choice) => (
                            <li key={choice}>{renderTextWithLatex(choice)}</li>
                          ))}
                        </ul>
                      )}
                      {card.explanation && (
                        <div className="card-explanation">
                          <span className="explanation-label">解説:</span>
                          <p>{renderTextWithLatex(card.explanation)}</p>
                        </div>
                      )}
                    </div>
                    <div className="card-meta">
                      <span>次回: {formatDateOnly(new Date(card.nextReviewAt))}</span>
                      <span>間隔: {card.intervalDays} 日</span>
                      <span>復習回数: {card.reviewCount}</span>
                      <div className="card-actions">
                        <button
                          type="button"
                          onClick={() => openEditModal(card)}
                        >
                          編集
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => handleDeleteCard(card.id)}
                        >
                          削除
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {activeTab === "test" && (
          <section className="panel">
            <h2>テスト</h2>
            {testStatus === "idle" && (
              <div className="test-start">
                <p>現在のデッキから選択式問題をランダム出題します。</p>
                <button
                  type="button"
                  className="primary"
                  onClick={() =>
                    startTest(
                      cards.filter(
                        (card) =>
                          card.deck === activeDeck && card.type === "choice"
                      ) as ChoiceCard[]
                    )
                  }
                >
                  ランダムテスト開始
                </button>
              </div>
            )}
            {testStatus === "in_progress" && testCards[testIndex] && (
              <div className="test-session">
                <div className="review__header">
                  <span>
                    {testIndex + 1}/{testCards.length}
                  </span>
                  <button type="button" onClick={resetTest}>
                    終了
                  </button>
                </div>
                <h3>{renderTextWithLatex(testCards[testIndex].question)}</h3>
                <div className="review__choices">
                  {testCards[testIndex].choices.map((choice) => {
                    const isSelected = testSelection === choice;
                    const isCorrect =
                      testSelection && choice === testCards[testIndex].answer;
                    const isWrongSelected =
                      isSelected && choice !== testCards[testIndex].answer;
                    return (
                      <button
                        key={choice}
                        type="button"
                        className={[
                          "choice-button",
                          isSelected ? "is-selected" : "",
                          isCorrect ? "is-correct" : "",
                          isWrongSelected ? "is-wrong" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() => handleTestSelect(choice)}
                        disabled={!!testSelection}
                      >
                        {renderTextWithLatex(choice)}
                      </button>
                    );
                  })}
                </div>
                {testSelection && (
                  <div className="test-feedback">
                    <p className="review__answer">
                      正解: {renderTextWithLatex(testCards[testIndex].answer)}
                      {testSelection === testCards[testIndex].answer
                        ? " ✅"
                        : " ❌"}
                    </p>
                    {testCards[testIndex].explanation && (
                      <div className="review__explanation">
                        <span className="explanation-label">解説</span>
                        <p>
                          {renderTextWithLatex(testCards[testIndex].explanation)}
                        </p>
                      </div>
                    )}
                  </div>
                )}
                <div className="review__actions">
                  <button type="button" onClick={goToNextTestCard}>
                    次へ
                  </button>
                </div>
              </div>
            )}
            {testStatus === "finished" && (
              <div className="test-summary">
                <h3>結果</h3>
                <p>
                  正答 {testResults.filter((r) => r.isCorrect).length} /{" "}
                  {testResults.length}
                </p>
                <p>
                  正答率{" "}
                  {testResults.length
                    ? Math.round(
                        (testResults.filter((r) => r.isCorrect).length /
                          testResults.length) *
                          100
                      )
                    : 0}
                  %
                </p>
                {testResults.some((r) => !r.isCorrect) ? (
                  <button
                    type="button"
                    className="primary"
                    onClick={startRetryWrongOnly}
                  >
                    間違いのみ再テスト
                  </button>
                ) : (
                  <p className="empty">全問正解です！</p>
                )}
                <button type="button" onClick={resetTest}>
                  終了
                </button>
              </div>
            )}
          </section>
        )}

        {activeTab === "review" && (
          <section className="panel">
            <h2>復習セッション</h2>
            {dueCards.length === 0 ? (
              <div>
                <p className="empty">今日復習するカードはありません。</p>
                <button type="button" onClick={() => setActiveTab("import")}>
                  取り込みに戻る
                </button>
              </div>
            ) : (
              <div className="review">
                <div className="review__header">
                  <span>
                    {reviewIndex + 1}/{dueCards.length}
                  </span>
                  <button type="button" onClick={resetReviewSession}>
                    先頭に戻る
                  </button>
                </div>
                {currentReviewCard ? (
                  <div className="review__card">
                    <h3>{renderTextWithLatex(currentReviewCard.question)}</h3>
                    {currentReviewCard.type === "choice" ? (
                      <div className="review__choices">
                        {currentReviewCard.choices.map((choice) => (
                          <button
                            key={choice}
                            type="button"
                            className={
                              selectedChoice === choice
                                ? "choice-button is-selected"
                                : "choice-button"
                            }
                            onClick={() => handleChoiceSelect(choice)}
                          >
                            {renderTextWithLatex(choice)}
                          </button>
                        ))}
                      </div>
                    ) : showAnswer ? (
                      <p className="review__answer">
                        {renderTextWithLatex(currentReviewCard.answer)}
                      </p>
                    ) : (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setShowAnswer(true)}
                      >
                        回答を表示
                      </button>
                    )}
                    {currentReviewCard.type === "choice" && showAnswer && (
                      <div className="review__answer-block">
                        <p className="review__answer">
                          正解: {renderTextWithLatex(currentReviewCard.answer)}
                          {selectedChoice &&
                            (selectedChoice === currentReviewCard.answer
                              ? " ✅"
                              : " ❌")}
                        </p>
                        {currentReviewCard.explanation && (
                    <div className="review__explanation">
                      <span className="explanation-label">解説</span>
                      <p>{renderTextWithLatex(currentReviewCard.explanation)}</p>
                    </div>
                  )}
                      </div>
                    )}
                    {currentReviewCard.type === "basic" && showAnswer &&
                      currentReviewCard.explanation && (
                        <div className="review__explanation">
                          <span className="explanation-label">解説</span>
                          <p>{renderTextWithLatex(currentReviewCard.explanation)}</p>
                        </div>
                      )}
                    {showAnswer && (
                      <div className="review__actions">
                        <button type="button" onClick={() => handleReview("again")}>
                          もう一度
                        </button>
                        <button type="button" onClick={() => handleReview("hard")}>
                          難しい
                        </button>
                        <button
                          type="button"
                          className="primary"
                          onClick={() => handleReview("good")}
                        >
                          良い
                        </button>
                        <button type="button" onClick={() => handleReview("easy")}>
                          簡単
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="empty">セッション完了！お疲れさまでした。</p>
                )}
                <p className="review__meta">
                  次回復習: {formatDateTime(new Date(currentReviewCard?.nextReviewAt ?? Date.now()))}
                </p>
              </div>
            )}
          </section>
        )}
      </main>

      {editingCard && (
        <div className="modal-overlay" onClick={closeEditModal}>
          <div
            className="modal"
            onClick={(event) => event.stopPropagation()}
          >
            <h2>カード編集</h2>
            <label className="form-label">
              問題
              <textarea
                value={editDraft.question}
                onChange={(event) =>
                  setEditDraft((prev) => ({
                    ...prev,
                    question: event.target.value,
                  }))
                }
                rows={3}
              />
            </label>
            <label className="form-label">
              正解
              <input
                type="text"
                value={editDraft.answer}
                onChange={(event) =>
                  setEditDraft((prev) => ({
                    ...prev,
                    answer: event.target.value,
                  }))
                }
              />
            </label>
            {editingCard.type === "choice" && (
              <label className="form-label">
                選択肢（1行に1つ）
                <textarea
                  value={editDraft.choicesText}
                  onChange={(event) =>
                    setEditDraft((prev) => ({
                      ...prev,
                      choicesText: event.target.value,
                    }))
                  }
                  rows={4}
                />
              </label>
            )}
            <label className="form-label">
              解説
              <textarea
                value={editDraft.explanation}
                onChange={(event) =>
                  setEditDraft((prev) => ({
                    ...prev,
                    explanation: event.target.value,
                  }))
                }
                rows={4}
              />
            </label>
            <div className="modal-actions">
              <button type="button" onClick={closeEditModal}>
                キャンセル
              </button>
              <button type="button" className="primary" onClick={handleEditSave}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
