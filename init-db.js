
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const databasePath = process.env.DATABASE_PATH || "./data/pre-conselho.db";
const absoluteDatabasePath = path.resolve(databasePath);

fs.mkdirSync(path.dirname(absoluteDatabasePath), {
  recursive: true
});

const db = new Database(absoluteDatabasePath);

db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS schools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    email TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('diretor', 'professor')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (school_id, email),
    UNIQUE (id, school_id),

    FOREIGN KEY (school_id)
      REFERENCES schools(id)
      ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    grade TEXT,
    school_year INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (school_id, name, school_year),
    UNIQUE (id, school_id),

    FOREIGN KEY (school_id)
      REFERENCES schools(id)
      ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS teacher_classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL,
    teacher_id INTEGER NOT NULL,
    class_id INTEGER NOT NULL,

    UNIQUE (teacher_id, class_id),

    FOREIGN KEY (teacher_id, school_id)
      REFERENCES users(id, school_id)
      ON DELETE CASCADE,

    FOREIGN KEY (class_id, school_id)
      REFERENCES classes(id, school_id)
      ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS questionnaires (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL,
    created_by INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'rascunho'
      CHECK (status IN ('rascunho', 'enviado', 'encerrado')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at TEXT,

    UNIQUE (id, school_id),

    FOREIGN KEY (school_id)
      REFERENCES schools(id)
      ON DELETE CASCADE,

    FOREIGN KEY (created_by, school_id)
      REFERENCES users(id, school_id)
  );

  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL,
    questionnaire_id INTEGER NOT NULL,
    section TEXT,
    question_text TEXT NOT NULL,
    question_type TEXT NOT NULL DEFAULT 'texto'
      CHECK (
        question_type IN (
          'texto',
          'paragrafo',
          'multipla_escolha',
          'caixas_selecao',
          'sim_nao',
          'nota'
        )
      ),
    required INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    options_json TEXT NOT NULL DEFAULT '[]'
      CHECK (json_valid(options_json)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (questionnaire_id, school_id)
      REFERENCES questionnaires(id, school_id)
      ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS questionnaire_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL,
    questionnaire_id INTEGER NOT NULL,
    teacher_id INTEGER NOT NULL,
    class_id INTEGER,
    assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (questionnaire_id, school_id)
      REFERENCES questionnaires(id, school_id)
      ON DELETE CASCADE,

    FOREIGN KEY (teacher_id, school_id)
      REFERENCES users(id, school_id)
      ON DELETE CASCADE,

    FOREIGN KEY (class_id, school_id)
      REFERENCES classes(id, school_id)
      ON DELETE CASCADE
  );

  CREATE UNIQUE INDEX IF NOT EXISTS
    idx_assignment_without_class
    ON questionnaire_assignments (
      school_id,
      questionnaire_id,
      teacher_id
    )
    WHERE class_id IS NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS
    idx_assignment_with_class
    ON questionnaire_assignments (
      school_id,
      questionnaire_id,
      teacher_id,
      class_id
    )
    WHERE class_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL,
    questionnaire_id INTEGER NOT NULL,
    teacher_id INTEGER NOT NULL,
    class_id INTEGER,
    responses_json TEXT NOT NULL
      CHECK (json_valid(responses_json)),
    submitted_at TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (questionnaire_id, school_id)
      REFERENCES questionnaires(id, school_id)
      ON DELETE CASCADE,

    FOREIGN KEY (teacher_id, school_id)
      REFERENCES users(id, school_id)
      ON DELETE CASCADE,

    FOREIGN KEY (class_id, school_id)
      REFERENCES classes(id, school_id)
      ON DELETE CASCADE
  );

  CREATE UNIQUE INDEX IF NOT EXISTS
    idx_answer_without_class
    ON answers (
      school_id,
      questionnaire_id,
      teacher_id
    )
    WHERE class_id IS NULL;

  CREATE UNIQUE INDEX IF NOT EXISTS
    idx_answer_with_class
    ON answers (
      school_id,
      questionnaire_id,
      teacher_id,
      class_id
    )
    WHERE class_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL,
    user_id INTEGER,
    action TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (school_id)
      REFERENCES schools(id)
      ON DELETE CASCADE,

    FOREIGN KEY (user_id, school_id)
      REFERENCES users(id, school_id)
      ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_users_school
    ON users(school_id);

  CREATE INDEX IF NOT EXISTS idx_classes_school
    ON classes(school_id);

  CREATE INDEX IF NOT EXISTS idx_questionnaires_school
    ON questionnaires(school_id);

  CREATE INDEX IF NOT EXISTS idx_questions_questionnaire
    ON questions(questionnaire_id);

  CREATE INDEX IF NOT EXISTS idx_answers_questionnaire
    ON answers(school_id, questionnaire_id);

  CREATE INDEX IF NOT EXISTS idx_history_school
    ON history(school_id, created_at);
`);

console.log("Banco de dados criado ou verificado com sucesso.");
console.log("Local do banco:", absoluteDatabasePath);

db.close();
