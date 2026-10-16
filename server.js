
const express = require("express");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

if (!process.env.JWT_SECRET ||
    process.env.JWT_SECRET === "SUBSTITUA_PELA_SUA_CHAVE_SECRETA") {
  console.error("ERRO: configure uma chave JWT_SECRET válida no arquivo .env.");
  process.exit(1);
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const databasePath = path.resolve(
  process.env.DATABASE_PATH || "./data/pre-conselho.db"
);

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new Database(databasePath);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ======================================================
// FUNÇÕES AUXILIARES
// ======================================================

function sendError(res, status, message) {
  return res.status(status).json({ erro: message });
}

function getUserById(id, schoolId) {
  return db.prepare(`
    SELECT id, school_id, name, email, role, active
    FROM users
    WHERE id = ? AND school_id = ? AND active = 1
  `).get(id, schoolId);
}

function logHistory(schoolId, userId, action, description) {
  db.prepare(`
    INSERT INTO history (school_id, user_id, action, description)
    VALUES (?, ?, ?, ?)
  `).run(schoolId, userId || null, action, description || null);
}

function validId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function parseOptions(options) {
  if (Array.isArray(options)) return options;
  if (typeof options === "string") {
    try {
      const parsed = JSON.parse(options);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function getQuestionnaire(id, schoolId) {
  return db.prepare(`
    SELECT *
    FROM questionnaires
    WHERE id = ? AND school_id = ?
  `).get(id, schoolId);
}

// ======================================================
// AUTENTICAÇÃO
// ======================================================

function authenticateToken(req, res, next) {
  const header = req.headers.authorization || "";
  const parts = header.split(" ");

  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return sendError(res, 401, "Faça login para continuar.");
  }

  try {
    const payload = jwt.verify(parts[1], process.env.JWT_SECRET);

    const user = getUserById(payload.id, payload.schoolId);

    if (!user || user.role !== payload.role) {
      return sendError(res, 401, "Sessão inválida ou usuário inativo.");
    }

    req.user = {
      id: user.id,
      schoolId: user.school_id,
      name: user.name,
      email: user.email,
      role: user.role
    };

    next();
  } catch {
    return sendError(res, 401, "Token inválido ou expirado. Entre novamente.");
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return sendError(res, 403, "Você não tem permissão para esta ação.");
    }
    next();
  };
}

function requireDirector(req, res, next) {
  return requireRole("diretor")(req, res, next);
}

function requireTeacher(req, res, next) {
  return requireRole("professor")(req, res, next);
}

// ======================================================
// STATUS DO SERVIDOR
// ======================================================

app.get("/api/status", (req, res) => {
  res.json({
    online: true,
    sistema: "Pré-Conselho de Classe",
    mensagem: "Servidor funcionando."
  });
});

// ======================================================
// CADASTRO DE ESCOLA E DIRETOR
// ======================================================

app.post("/api/auth/register-school", (req, res) => {
  const name = String(req.body.schoolName || "").trim();
  const directorName = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const schoolEmail = String(req.body.schoolEmail || "").trim().toLowerCase();

  if (!name || !directorName || !email || !password) {
    return sendError(
      res,
      400,
      "Informe o nome da escola, o nome do diretor, o e-mail e a senha."
    );
  }

  if (name.length > 150 || directorName.length > 150) {
    return sendError(res, 400, "Os nomes devem ter até 150 caracteres.");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return sendError(res, 400, "Informe um e-mail válido.");
  }

  if (password.length < 8 || password.length > 128) {
    return sendError(res, 400, "A senha deve ter entre 8 e 128 caracteres.");
  }

  const createSchool = db.transaction(() => {
    const schoolCode = require("crypto")
      .randomBytes(6)
      .toString("hex")
      .toUpperCase();

    const schoolResult = db.prepare(`
      INSERT INTO schools (name, code, email)
      VALUES (?, ?, ?)
    `).run(name, schoolCode, schoolEmail || null);

    const schoolId = Number(schoolResult.lastInsertRowid);
    const passwordHash = bcrypt.hashSync(password, 12);

    const userResult = db.prepare(`
      INSERT INTO users (school_id, name, email, password_hash, role)
      VALUES (?, ?, ?, ?, 'diretor')
    `).run(schoolId, directorName, email, passwordHash);

    const userId = Number(userResult.lastInsertRowid);

    logHistory(
      schoolId,
      userId,
      "ESCOLA_CRIADA",
      "Escola cadastrada no sistema."
    );

    return { schoolId, schoolCode, userId };
  });

  try {
    const result = createSchool();

    return res.status(201).json({
      mensagem: "Escola e diretor cadastrados com sucesso.",
      escola: {
        id: result.schoolId,
        nome: name,
        codigo: result.schoolCode
      },
      usuario: {
        id: result.userId,
        nome: directorName,
        email,
        perfil: "diretor"
      }
    });
  } catch (error) {
    if (String(error.code).startsWith("SQLITE_CONSTRAINT")) {
      return sendError(
        res,
        409,
        "Não foi possível cadastrar a escola. Verifique os dados informados."
      );
    }

    console.error("Erro no cadastro da escola:", error);
    return sendError(res, 500, "Erro interno ao cadastrar a escola.");
  }
});

// ======================================================
// CADASTRO DE PROFESSOR
// O professor precisa do código da própria escola.
// ======================================================

app.post("/api/auth/register-teacher", (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const schoolCode = String(req.body.schoolCode || "")
    .trim()
    .toUpperCase();

  if (!name || !email || !password || !schoolCode) {
    return sendError(
      res,
      400,
      "Informe nome, e-mail, senha e código da escola."
    );
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return sendError(res, 400, "Informe um e-mail válido.");
  }

  if (password.length < 8 || password.length > 128) {
    return sendError(res, 400, "A senha deve ter entre 8 e 128 caracteres.");
  }

  const school = db.prepare(`
    SELECT id, name
    FROM schools
    WHERE code = ? AND active = 1
  `).get(schoolCode);

  if (!school) {
    return sendError(res, 404, "Código da escola inválido.");
  }

  try {
    const passwordHash = bcrypt.hashSync(password, 12);

    const result = db.prepare(`
      INSERT INTO users (school_id, name, email, password_hash, role)
      VALUES (?, ?, ?, ?, 'professor')
    `).run(school.id, name, email, passwordHash);

    const userId = Number(result.lastInsertRowid);

    logHistory(
      school.id,
      userId,
      "PROFESSOR_CADASTRADO",
      "Professor cadastrado."
    );

    return res.status(201).json({
      mensagem: "Professor cadastrado com sucesso.",
      usuario: {
        id: userId,
        nome: name,
        email,
        perfil: "professor",
        escola: school.name
      }
    });
  } catch (error) {
    if (String(error.code).startsWith("SQLITE_CONSTRAINT")) {
      return sendError(
        res,
        409,
        "Este e-mail já está cadastrado nesta escola."
      );
    }

    console.error("Erro no cadastro do professor:", error);
    return sendError(res, 500, "Erro interno ao cadastrar o professor.");
  }
});

// ======================================================
// LOGIN
// ======================================================

app.post("/api/auth/login", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const schoolCode = String(req.body.schoolCode || "")
    .trim()
    .toUpperCase();

  if (!email || !password) {
    return sendError(res, 400, "Informe o e-mail e a senha.");
  }

  let user;

  if (schoolCode) {
    user = db.prepare(`
      SELECT
        users.id,
        users.school_id,
        users.name,
        users.email,
        users.password_hash,
        users.role,
        users.active,
        schools.name AS school_name,
        schools.code AS school_code
      FROM users
      JOIN schools ON schools.id = users.school_id
      WHERE users.email = ?
        AND schools.code = ?
        AND schools.active = 1
    `).get(email, schoolCode);
  } else {
    const matches = db.prepare(`
      SELECT
        users.id,
        users.school_id,
        users.name,
        users.email,
        users.password_hash,
        users.role,
        users.active,
        schools.name AS school_name,
        schools.code AS school_code
      FROM users
      JOIN schools ON schools.id = users.school_id
      WHERE users.email = ?
        AND schools.active = 1
    `).all(email);

    if (matches.length > 1) {
      return sendError(
        res,
        400,
        "Este e-mail está cadastrado em mais de uma escola. Informe o código da escola."
      );
    }

    user = matches[0];
  }

  if (
    !user ||
    !user.active ||
    !bcrypt.compareSync(password, user.password_hash)
  ) {
    return sendError(res, 401, "E-mail, senha ou escola inválidos.");
  }

  const token = jwt.sign(
    {
      id: user.id,
      schoolId: user.school_id,
      role: user.role
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
  );

  logHistory(
    user.school_id,
    user.id,
    "LOGIN",
    "Usuário entrou no sistema."
  );

  return res.json({
    mensagem: "Login realizado com sucesso.",
    token,
    usuario: {
      id: user.id,
      nome: user.name,
      email: user.email,
      perfil: user.role,
      escola: user.school_name,
      codigoEscola: user.school_code
    }
  });
});

// ======================================================
// DADOS DO USUÁRIO LOGADO
// ======================================================

app.get("/api/auth/me", authenticateToken, (req, res) => {
  const school = db.prepare(`
    SELECT id, name, code
    FROM schools
    WHERE id = ?
  `).get(req.user.schoolId);

  res.json({
    usuario: req.user,
    escola: school
  });
});

// ======================================================
// TURMAS - SOMENTE DIRETOR PODE CADASTRAR
// ======================================================

app.get(
  "/api/classes",
  authenticateToken,
  (req, res) => {
    if (req.user.role === "diretor") {
      const classes = db.prepare(`
        SELECT id, name, grade, school_year, active
        FROM classes
        WHERE school_id = ?
        ORDER BY school_year DESC, name
      `).all(req.user.schoolId);

      return res.json({ turmas: classes });
    }

    const classes = db.prepare(`
      SELECT c.id, c.name, c.grade, c.school_year
      FROM classes c
      JOIN teacher_classes tc
        ON tc.class_id = c.id
       AND tc.school_id = c.school_id
      WHERE tc.teacher_id = ?
        AND tc.school_id = ?
        AND c.active = 1
      ORDER BY c.school_year DESC, c.name
    `).all(req.user.id, req.user.schoolId);

    return res.json({ turmas: classes });
  }
);

app.post(
  "/api/classes",
  authenticateToken,
  requireDirector,
  (req, res) => {
    const name = String(req.body.name || "").trim();
    const grade = String(req.body.grade || "").trim();
    const schoolYear = Number(
      req.body.schoolYear || new Date().getFullYear()
    );

    if (!name) {
      return sendError(res, 400, "Informe o nome da turma.");
    }

    if (
      !Number.isInteger(schoolYear) ||
      schoolYear < 2000 ||
      schoolYear > 2100
    ) {
      return sendError(res, 400, "Ano letivo inválido.");
    }

    try {
      const result = db.prepare(`
        INSERT INTO classes (school_id, name, grade, school_year)
        VALUES (?, ?, ?, ?)
      `).run(
        req.user.schoolId,
        name,
        grade || null,
        schoolYear
      );

      logHistory(
        req.user.schoolId,
        req.user.id,
        "TURMA_CRIADA",
        `Turma ${name} cadastrada.`
      );

      return res.status(201).json({
        mensagem: "Turma cadastrada com sucesso.",
        turma: {
          id: Number(result.lastInsertRowid),
          nome: name,
          anoLetivo: schoolYear
        }
      });
    } catch (error) {
      if (String(error.code).startsWith("SQLITE_CONSTRAINT")) {
        return sendError(
          res,
          409,
          "Já existe uma turma com esse nome nesse ano letivo."
        );
      }

      console.error(error);
      return sendError(res, 500, "Erro ao cadastrar a turma.");
    }
  }
);

// Vincular professor a uma turma
app.post(
  "/api/classes/:classId/teachers",
  authenticateToken,
  requireDirector,
  (req, res) => {
    const classId = validId(req.params.classId);
    const teacherId = validId(req.body.teacherId);

    if (!classId || !teacherId) {
      return sendError(res, 400, "Informe uma turma e um professor válidos.");
    }

    const teacher = db.prepare(`
      SELECT id
      FROM users
      WHERE id = ?
        AND school_id = ?
        AND role = 'professor'
        AND active = 1
    `).get(teacherId, req.user.schoolId);

    const classroom = db.prepare(`
      SELECT id, name
      FROM classes
      WHERE id = ? AND school_id = ? AND active = 1
    `).get(classId, req.user.schoolId);

    if (!teacher || !classroom) {
      return sendError(
        res,
        404,
        "Professor ou turma não encontrado nesta escola."
      );
    }

    try {
      db.prepare(`
        INSERT INTO teacher_classes (school_id, teacher_id, class_id)
        VALUES (?, ?, ?)
      `).run(req.user.schoolId, teacherId, classId);

      logHistory(
        req.user.schoolId,
        req.user.id,
        "PROFESSOR_VINCULADO",
        `Professor ${teacherId} vinculado à turma ${classroom.name}.`
      );

      return res.status(201).json({
        mensagem: "Professor vinculado à turma com sucesso."
      });
    } catch (error) {
      if (String(error.code).startsWith("SQLITE_CONSTRAINT")) {
        return sendError(res, 409, "Esse vínculo já existe.");
      }

      console.error(error);
      return sendError(res, 500, "Erro ao vincular professor.");
    }
  }
);

// ======================================================
// PROFESSORES DA ESCOLA
// ======================================================

app.get(
  "/api/teachers",
  authenticateToken,
  requireDirector,
  (req, res) => {
    const teachers = db.prepare(`
      SELECT id, name, email, active, created_at
      FROM users
      WHERE school_id = ?
        AND role = 'professor'
      ORDER BY name
    `).all(req.user.schoolId);

    res.json({ professores: teachers });
  }
);

// ======================================================
// QUESTIONÁRIOS - CRIAÇÃO E EDIÇÃO PELO DIRETOR
// ======================================================

app.get(
  "/api/questionnaires",
  authenticateToken,
  (req, res) => {
    if (req.user.role === "diretor") {
      const questionnaires = db.prepare(`
        SELECT
          q.id,
          q.title,
          q.description,
          q.status,
          q.created_at,
          q.updated_at,
          q.sent_at,
          (
            SELECT COUNT(*)
            FROM questions qu
            WHERE qu.questionnaire_id = q.id
              AND qu.school_id = q.school_id
          ) AS total_perguntas
        FROM questionnaires q
        WHERE q.school_id = ?
        ORDER BY q.created_at DESC
      `).all(req.user.schoolId);

      return res.json({ questionarios: questionnaires });
    }

    const questionnaires = db.prepare(`
      SELECT DISTINCT
        q.id,
        q.title,
        q.description,
        q.status,
        q.sent_at,
        (
          SELECT COUNT(*)
          FROM questions qu
          WHERE qu.questionnaire_id = q.id
            AND qu.school_id = q.school_id
        ) AS total_perguntas,
        (
          SELECT a.submitted_at
          FROM answers a
          WHERE a.school_id = q.school_id
            AND a.questionnaire_id = q.id
            AND a.teacher_id = ?
            AND a.class_id IS NULL
        ) AS enviado_em
      FROM questionnaires q
      JOIN questionnaire_assignments qa
        ON qa.questionnaire_id = q.id
       AND qa.school_id = q.school_id
      WHERE q.school_id = ?
        AND qa.teacher_id = ?
        AND q.status = 'enviado'
      ORDER BY q.sent_at DESC
    `).all(req.user.id, req.user.schoolId, req.user.id);

    return res.json({ questionarios: questionnaires });
  }
);

app.post(
  "/api/questionnaires",
  authenticateToken,
  requireDirector,
  (req, res) => {
    const title = String(req.body.title || "").trim();
    const description = String(req.body.description || "").trim();

    if (!title) {
      return sendError(res, 400, "Informe o título do questionário.");
    }

    try {
      const result = db.prepare(`
        INSERT INTO questionnaires
          (school_id, created_by, title, description)
        VALUES (?, ?, ?, ?)
      `).run(
        req.user.schoolId,
        req.user.id,
        title,
        description || null
      );

      const id = Number(result.lastInsertRowid);

      logHistory(
        req.user.schoolId,
        req.user.id,
        "QUESTIONARIO_CRIADO",
        `Questionário "${title}" criado.`
      );

      return res.status(201).json({
        mensagem: "Questionário criado como rascunho.",
        questionario: { id, titulo: title, status: "rascunho" }
      });
    } catch (error) {
      console.error(error);
      return sendError(res, 500, "Erro ao criar questionário.");
    }
  }
);

app.put(
  "/api/questionnaires/:id",
  authenticateToken,
  requireDirector,
  (req, res) => {
    const id = validId(req.params.id);
    const title = String(req.body.title || "").trim();
    const description = String(req.body.description || "").trim();

    if (!id || !title) {
      return sendError(res, 400, "Informe um questionário válido e seu título.");
    }

    const questionnaire = getQuestionnaire(id, req.user.schoolId);

    if (!questionnaire) {
      return sendError(res, 404, "Questionário não encontrado.");
    }

    if (questionnaire.status !== "rascunho") {
      return sendError(
        res,
        409,
        "Somente questionários em rascunho podem ser editados."
      );
    }

    db.prepare(`
      UPDATE questionnaires
      SET title = ?, description = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND school_id = ?
    `).run(title, description || null, id, req.user.schoolId);

    logHistory(
      req.user.schoolId,
      req.user.id,
      "QUESTIONARIO_EDITADO",
      `Questionário ${id} editado.`
    );

    res.json({ mensagem: "Questionário atualizado com sucesso." });
  }
);

// ======================================================
// PERGUNTAS DO QUESTIONÁRIO
// ======================================================

app.get(
  "/api/questionnaires/:id/questions",
  authenticateToken,
  (req, res) => {
    const questionnaireId = validId(req.params.id);

    if (!questionnaireId) {
      return sendError(res, 400, "Questionário inválido.");
    }

    const questionnaire = getQuestionnaire(
      questionnaireId,
      req.user.schoolId
    );

    if (!questionnaire) {
      return sendError(res, 404, "Questionário não encontrado.");
    }

    if (req.user.role === "professor") {
      const assignment = db.prepare(`
        SELECT id
        FROM questionnaire_assignments
        WHERE school_id = ?
          AND questionnaire_id = ?
          AND teacher_id = ?
        LIMIT 1
      `).get(req.user.schoolId, questionnaireId, req.user.id);

      if (!assignment || questionnaire.status !== "enviado") {
        return sendError(
          res,
          403,
          "Este questionário não está disponível para você."
        );
      }
    }

    const questions = db.prepare(`
      SELECT
        id,
        section,
        question_text,
        question_type,
        required,
        position,
        options_json
      FROM questions
      WHERE school_id = ? AND questionnaire_id = ?
      ORDER BY position, id
    `).all(req.user.schoolId, questionnaireId);

    res.json({
      questionario: {
        id: questionnaire.id,
        titulo: questionnaire.title,
        descricao: questionnaire.description,
        status: questionnaire.status
      },
      perguntas: questions.map(question => ({
        id: question.id,
        secao: question.section,
        texto: question.question_text,
        tipo: question.question_type,
        obrigatoria: Boolean(question.required),
        posicao: question.position,
        opcoes: parseOptions(question.options_json)
      }))
    });
  }
);

app.post(
  "/api/questionnaires/:id/questions",
  authenticateToken,
  requireDirector,
  (req, res) => {
    const questionnaireId = validId(req.params.id);
    const text = String(req.body.text || "").trim();
    const section = String(req.body.section || "").trim();
    const type = String(req.body.type || "texto");
    const required = req.body.required ? 1 : 0;
    const position = Number(req.body.position) || 0;
    const options = parseOptions(req.body.options);

    const validTypes = [
      "texto",
      "paragrafo",
      "multipla_escolha",
      "caixas_selecao",
      "sim_nao",
      "nota"
    ];

    if (!questionnaireId || !text) {
      return sendError(res, 400, "Informe o questionário e o texto da pergunta.");
    }

    if (!validTypes.includes(type)) {
      return sendError(res, 400, "Tipo de pergunta inválido.");
    }

    if (options.length > 100) {
      return sendError(res, 400, "A pergunta pode ter até 100 opções.");
    }

    const questionnaire = getQuestionnaire(
      questionnaireId,
      req.user.schoolId
    );

    if (!questionnaire) {
      return sendError(res, 404, "Questionário não encontrado.");
    }

    if (questionnaire.status !== "rascunho") {
      return sendError(
        res,
        409,
        "Não é possível alterar perguntas depois do envio."
      );
    }

    try {
      const result = db.prepare(`
        INSERT INTO questions (
          school_id,
          questionnaire_id,
          section,
          question_text,
          question_type,
          required,
          position,
          options_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.user.schoolId,
        questionnaireId,
        section || null,
        text,
        type,
        required,
        position,
        JSON.stringify(options)
      );

      db.prepare(`
        UPDATE questionnaires
        SET updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND school_id = ?
      `).run(questionnaireId, req.user.schoolId);

      logHistory(
        req.user.schoolId,
        req.user.id,
        "PERGUNTA_CRIADA",
        `Pergunta adicionada ao questionário ${questionnaireId}.`
      );

      return res.status(201).json({
        mensagem: "Pergunta adicionada com sucesso.",
        perguntaId: Number(result.lastInsertRowid)
      });
    } catch (error) {
      console.error(error);
      return sendError(res, 500, "Erro ao adicionar pergunta.");
    }
  }
);

// ======================================================
// ENVIAR QUESTIONÁRIO AOS PROFESSORES
// Corpo esperado:
// {
//   "teacherIds": [2, 3],
//   "classIds": [1, 2]
// }
//
// Para enviar para cada professor sem associar turma,
// use classIds: [].
// ======================================================

app.post(
  "/api/questionnaires/:id/send",
  authenticateToken,
  requireDirector,
  (req, res) => {
    const questionnaireId = validId(req.params.id);

    if (!questionnaireId) {
      return sendError(res, 400, "Questionário inválido.");
    }

    const questionnaire = getQuestionnaire(
      questionnaireId,
      req.user.schoolId
    );

    if (!questionnaire) {
      return sendError(res, 404, "Questionário não encontrado.");
    }

    if (questionnaire.status !== "rascunho") {
      return sendError(
        res,
        409,
        "Este questionário já foi enviado ou encerrado."
      );
    }

    const questionCount = db.prepare(`
      SELECT COUNT(*) AS total
      FROM questions
      WHERE school_id = ? AND questionnaire_id = ?
    `).get(req.user.schoolId, questionnaireId).total;

    if (questionCount === 0) {
      return sendError(
        res,
        400,
        "Adicione pelo menos uma pergunta antes de enviar."
      );
    }

    const teacherIds = Array.isArray(req.body.teacherIds)
      ? [...new Set(req.body.teacherIds.map(validId).filter(Boolean))]
      : [];

    const classIds = Array.isArray(req.body.classIds)
      ? [...new Set(req.body.classIds.map(validId).filter(Boolean))]
      : [];

    if (teacherIds.length === 0) {
      return sendError(
        res,
        400,
        "Selecione pelo menos um professor."
      );
    }

    const assign = db.transaction(() => {
      let assignmentCount = 0;

      for (const teacherId of teacherIds) {
        const teacher = db.prepare(`
          SELECT id
          FROM users
          WHERE id = ?
            AND school_id = ?
            AND role = 'professor'
            AND active = 1
        `).get(teacherId, req.user.schoolId);

        if (!teacher) {
          throw new Error(
            `O professor ${teacherId} não pertence a esta escola ou está inativo.`
          );
        }

        if (classIds.length === 0) {
          db.prepare(`
            INSERT INTO questionnaire_assignments (
              school_id, questionnaire_id, teacher_id, class_id
            )
            VALUES (?, ?, ?, NULL)
          `).run(req.user.schoolId, questionnaireId, teacherId);

          assignmentCount++;
        } else {
          for (const classId of classIds) {
            const link = db.prepare(`
              SELECT id
              FROM teacher_classes
              WHERE school_id = ?
                AND teacher_id = ?
                AND class_id = ?
            `).get(req.user.schoolId, teacherId, classId);

            if (!link) {
              throw new Error(
                `O professor ${teacherId} não está vinculado à turma ${classId}.`
              );
            }

            db.prepare(`
              INSERT INTO questionnaire_assignments (
                school_id, questionnaire_id, teacher_id, class_id
              )
              VALUES (?, ?, ?, ?)
            `).run(
              req.user.schoolId,
              questionnaireId,
              teacherId,
              classId
            );

            assignmentCount++;
          }
        }
      }

      db.prepare(`
        UPDATE questionnaires
        SET status = 'enviado',
            sent_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND school_id = ?
      `).run(questionnaireId, req.user.schoolId);

      logHistory(
        req.user.schoolId,
        req.user.id,
        "QUESTIONARIO_ENVIADO",
        `Questionário ${questionnaireId} enviado para os professores selecionados.`
      );

      return assignmentCount;
    });

    try {
      const total = assign();

      return res.json({
        mensagem: "Questionário enviado com sucesso.",
        atribuicoes: total
      });
    } catch (error) {
      if (String(error.code).startsWith("SQLITE_CONSTRAINT")) {
        return sendError(
          res,
          409,
          "Uma ou mais atribuições já existem. Verifique os destinatários."
        );
      }

      if (error.message.startsWith("O professor ")) {
        return sendError(res, 400, error.message);
      }

      console.error(error);
      return sendError(res, 500, "Erro ao enviar o questionário.");
    }
  }
);

// ======================================================
// ENCERRAR QUESTIONÁRIO
// ======================================================

app.post(
  "/api/questionnaires/:id/close",
  authenticateToken,
  requireDirector,
  (req, res) => {
    const id = validId(req.params.id);
    const questionnaire = id
      ? getQuestionnaire(id, req.user.schoolId)
      : null;

    if (!questionnaire) {
      return sendError(res, 404, "Questionário não encontrado.");
    }

    db.prepare(`
      UPDATE questionnaires
      SET status = 'encerrado', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND school_id = ?
    `).run(id, req.user.schoolId);

    logHistory(
      req.user.schoolId,
      req.user.id,
      "QUESTIONARIO_ENCERRADO",
      `Questionário ${id} encerrado.`
    );

    res.json({ mensagem: "Questionário encerrado." });
  }
);

// ======================================================
// RESPOSTAS - PROFESSOR
// O professor só pode responder atribuições próprias.
// ======================================================

app.post(
  "/api/questionnaires/:id/answers",
  authenticateToken,
  requireTeacher,
  (req, res) => {
    const questionnaireId = validId(req.params.id);
    const classId = req.body.classId == null || req.body.classId === ""
      ? null
      : validId(req.body.classId);

    const responses = req.body.responses;

    if (!questionnaireId) {
      return sendError(res, 400, "Questionário inválido.");
    }

    if (
      !responses ||
      typeof responses !== "object" ||
      Array.isArray(responses)
    ) {
      return sendError(res, 400, "Envie as respostas em um objeto válido.");
    }

    const questionnaire = getQuestionnaire(
      questionnaireId,
      req.user.schoolId
    );

    if (!questionnaire || questionnaire.status !== "enviado") {
      return sendError(
        res,
        404,
        "Questionário não encontrado ou não está disponível."
      );
    }

    const assignment = classId === null
      ? db.prepare(`
          SELECT id
          FROM questionnaire_assignments
          WHERE school_id = ?
            AND questionnaire_id = ?
            AND teacher_id = ?
            AND class_id IS NULL
        `).get(req.user.schoolId, questionnaireId, req.user.id)
      : db.prepare(`
          SELECT id
          FROM questionnaire_assignments
          WHERE school_id = ?
            AND questionnaire_id = ?
            AND teacher_id = ?
            AND class_id = ?
        `).get(
          req.user.schoolId,
          questionnaireId,
          req.user.id,
          classId
        );

    if (!assignment) {
      return sendError(
        res,
        403,
        "Você não recebeu este questionário para esta turma."
      );
    }

    const questions = db.prepare(`
      SELECT id, question_text, question_type, required, options_json
      FROM questions
      WHERE school_id = ? AND questionnaire_id = ?
    `).all(req.user.schoolId, questionnaireId);

    for (const question of questions) {
      const value = responses[String(question.id)];

      const empty = value === undefined ||
        value === null ||
        value === "" ||
        (Array.isArray(value) && value.length === 0);

      if (question.required && empty) {
        return sendError(
          res,
          400,
          `A pergunta "${question.question_text}" é obrigatória.`
        );
      }

      if (!empty) {
        if (
          question.question_type === "multipla_escolha" ||
          question.question_type === "caixas_selecao"
        ) {
          const options = parseOptions(question.options_json);
          const selected = Array.isArray(value) ? value : [value];

          if (
            selected.some(option => !options.includes(option)) ||
            (
              question.question_type === "multipla_escolha" &&
              selected.length > 1
            )
          ) {
            return sendError(
              res,
              400,
              `Resposta inválida para "${question.question_text}".`
            );
          }
        }

        if (question.question_type === "sim_nao" &&
            !["sim", "não", "nao"].includes(String(value).toLowerCase())) {
          return sendError(
            res,
            400,
            `Selecione sim ou não para "${question.question_text}".`
          );
        }

        if (question.question_type === "nota") {
          const score = Number(value);

          if (!Number.isFinite(score) || score < 0 || score > 10) {
            return sendError(
              res,
              400,
              `A nota da pergunta "${question.question_text}" deve estar entre 0 e 10.`
            );
          }
        }
      }
    }

    // Não permite enviar IDs de perguntas que pertencem a outro questionário.
    const allowedIds = new Set(questions.map(question => String(question.id)));

    for (const key of Object.keys(responses)) {
      if (!allowedIds.has(key)) {
        return sendError(
          res,
          400,
          `A pergunta ${key} não pertence a este questionário.`
        );
      }
    }

    const existing = classId === null
      ? db.prepare(`
          SELECT id, submitted_at
          FROM answers
          WHERE school_id = ?
            AND questionnaire_id = ?
            AND teacher_id = ?
            AND class_id IS NULL
        `).get(req.user.schoolId, questionnaireId, req.user.id)
      : db.prepare(`
          SELECT id, submitted_at
          FROM answers
          WHERE school_id = ?
            AND questionnaire_id = ?
            AND teacher_id = ?
            AND class_id = ?
        `).get(
          req.user.schoolId,
          questionnaireId,
          req.user.id,
          classId
        );

    if (existing && existing.submitted_at) {
      return sendError(
        res,
        409,
        "Suas respostas já foram enviadas e não podem ser alteradas."
      );
    }

    const json = JSON.stringify(responses);

    if (existing) {
      db.prepare(`
        UPDATE answers
        SET responses_json = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND school_id = ? AND teacher_id = ?
      `).run(json, existing.id, req.user.schoolId, req.user.id);
    } else {
      db.prepare(`
        INSERT INTO answers (
          school_id,
          questionnaire_id,
          teacher_id,
          class_id,
          responses_json
        )
        VALUES (?, ?, ?, ?, ?)
      `).run(
        req.user.schoolId,
        questionnaireId,
        req.user.id,
        classId,
        json
      );
    }

    logHistory(
      req.user.schoolId,
      req.user.id,
      "RESPOSTAS_SALVAS",
      `Respostas do questionário ${questionnaireId} salvas como rascunho.`
    );

    res.json({
      mensagem: "Respostas salvas como rascunho.",
      enviado: false
    });
  }
);

// Enviar respostas definitivamente
app.post(
  "/api/questionnaires/:id/answers/submit",
  authenticateToken,
  requireTeacher,
  (req, res) => {
    const questionnaireId = validId(req.params.id);
    const classId = req.body.classId == null || req.body.classId === ""
      ? null
      : validId(req.body.classId);

    if (!questionnaireId) {
      return sendError(res, 400, "Questionário inválido.");
    }

    const questionnaire = getQuestionnaire(
      questionnaireId,
      req.user.schoolId
    );

    if (!questionnaire || questionnaire.status !== "enviado") {
      return sendError(res, 404, "Questionário indisponível.");
    }

    const assignment = classId === null
      ? db.prepare(`
          SELECT id
          FROM questionnaire_assignments
          WHERE school_id = ?
            AND questionnaire_id = ?
            AND teacher_id = ?
            AND class_id IS NULL
        `).get(req.user.schoolId, questionnaireId, req.user.id)
      : db.prepare(`
          SELECT id
          FROM questionnaire_assignments
          WHERE school_id = ?
            AND questionnaire_id = ?
            AND teacher_id = ?
            AND class_id = ?
        `).get(
          req.user.schoolId,
          questionnaireId,
          req.user.id,
          classId
        );

    if (!assignment) {
      return sendError(res, 403, "Este questionário não foi atribuído a você.");
    }

    const answer = classId === null
      ? db.prepare(`
          SELECT id, responses_json, submitted_at
          FROM answers
          WHERE school_id = ?
            AND questionnaire_id = ?
            AND teacher_id = ?
            AND class_id IS NULL
        `).get(req.user.schoolId, questionnaireId, req.user.id)
      : db.prepare(`
          SELECT id, responses_json, submitted_at
          FROM answers
          WHERE school_id = ?
            AND questionnaire_id = ?
            AND teacher_id = ?
            AND class_id = ?
        `).get(
          req.user.schoolId,
          questionnaireId,
          req.user.id,
          classId
        );

    if (!answer) {
      return sendError(
        res,
        400,
        "Salve suas respostas antes de enviá-las."
      );
    }

    if (answer.submitted_at) {
      return sendError(res, 409, "Estas respostas já foram enviadas.");
    }

    const responses = JSON.parse(answer.responses_json);
    const questions = db.prepare(`
      SELECT id, question_text, required, question_type, options_json
      FROM questions
      WHERE school_id = ? AND questionnaire_id = ?
    `).all(req.user.schoolId, questionnaireId);

    for (const question of questions) {
      const value = responses[String(question.id)];

      const empty = value === undefined ||
        value === null ||
        value === "" ||
        (Array.isArray(value) && value.length === 0);

      if (question.required && empty) {
        return sendError(
          res,
          400,
          `Responda à pergunta obrigatória: "${question.question_text}".`
        );
      }

      if (!empty) {
        if (
          question.question_type === "multipla_escolha" ||
          question.question_type === "caixas_selecao"
        ) {
          const options = parseOptions(question.options_json);
          const selected = Array.isArray(value) ? value : [value];

          if (
            selected.some(option => !options.includes(option)) ||
            (
              question.question_type === "multipla_escolha" &&
              selected.length > 1
            )
          ) {
            return sendError(
              res,
              400,
              `Resposta inválida para "${question.question_text}".`
            );
          }
        }

        if (
          question.question_type === "sim_nao" &&
          !["sim", "não", "nao"].includes(String(value).toLowerCase())
        ) {
          return sendError(
            res,
            400,
            `Selecione sim ou não para "${question.question_text}".`
          );
        }

        if (question.question_type === "nota") {
          const score = Number(value);
          if (!Number.isFinite(score) || score < 0 || score > 10) {
            return sendError(
              res,
              400,
              `A nota da pergunta "${question.question_text}" deve estar entre 0 e 10.`
            );
          }
        }
      }
    }

    const result = db.prepare(`
      UPDATE answers
      SET submitted_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND school_id = ?
        AND teacher_id = ?
        AND submitted_at IS NULL
    `).run(answer.id, req.user.schoolId, req.user.id);

    if (result.changes === 0) {
      return sendError(res, 409, "Não foi possível finalizar as respostas.");
    }

    logHistory(
      req.user.schoolId,
      req.user.id,
      "RESPOSTAS_ENVIADAS",
      `Respostas do questionário ${questionnaireId} enviadas.`
    );

    res.json({ mensagem: "Respostas enviadas com sucesso.", enviado: true });
  }
);

// ======================================================
// RESPOSTAS - SOMENTE DIRETOR DA MESMA ESCOLA
// Professores não possuem acesso a esta rota.
// ======================================================

app.get(
  "/api/questionnaires/:id/answers",
  authenticateToken,
  requireDirector,
  (req, res) => {
    const questionnaireId = validId(req.params.id);

    if (!questionnaireId) {
      return sendError(res, 400, "Questionário inválido.");
    }

    const questionnaire = getQuestionnaire(
      questionnaireId,
      req.user.schoolId
    );

    if (!questionnaire) {
      return sendError(res, 404, "Questionário não encontrado.");
    }

    const answers = db.prepare(`
      SELECT
        a.id,
        a.teacher_id,
        u.name AS teacher_name,
        u.email AS teacher_email,
        a.class_id,
        c.name AS class_name,
        a.responses_json,
        a.submitted_at,
        a.updated_at
      FROM answers a
      JOIN users u
        ON u.id = a.teacher_id
       AND u.school_id = a.school_id
      LEFT JOIN classes c
        ON c.id = a.class_id
       AND c.school_id = a.school_id
      WHERE a.school_id = ?
        AND a.questionnaire_id = ?
      ORDER BY a.submitted_at DESC, u.name
    `).all(req.user.schoolId, questionnaireId);

    res.json({
      questionario: {
        id: questionnaire.id,
        titulo: questionnaire.title
      },
      respostas: answers.map(answer => ({
        id: answer.id,
        professor: answer.teacher_name,
        emailProfessor: answer.teacher_email,
        turma: answer.class_name,
        respostas: JSON.parse(answer.responses_json),
        enviadoEm: answer.submitted_at,
        atualizadoEm: answer.updated_at
      }))
    });
  }
);

// ======================================================
// HISTÓRICO - SOMENTE DIRETOR
// ======================================================

app.get(
  "/api/history",
  authenticateToken,
  requireDirector,
  (req, res) => {
    const history = db.prepare(`
      SELECT
        h.id,
        h.action,
        h.description,
        h.created_at,
        u.name AS user_name
      FROM history h
      LEFT JOIN users u
        ON u.id = h.user_id
       AND u.school_id = h.school_id
      WHERE h.school_id = ?
      ORDER BY h.created_at DESC, h.id DESC
      LIMIT 500
    `).all(req.user.schoolId);

    res.json({ historico: history });
  }
);

// ======================================================
// ERROS E ROTAS NÃO ENCONTRADAS
// ======================================================

app.use("/api", (req, res) => {
  sendError(res, 404, "Rota da API não encontrada.");
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (error instanceof SyntaxError && "body" in error) {
    return sendError(res, 400, "O JSON enviado é inválido.");
  }

  console.error("Erro inesperado:", error);
  return sendError(res, 500, "Ocorreu um erro interno no servidor.");
});

// ======================================================
// INICIAR SERVIDOR
// ======================================================

const server = app.listen(PORT, () => {
  console.log("========================================");
  console.log(" PRÉ-CONSELHO DE CLASSE");
  console.log(" Servidor iniciado com sucesso");
  console.log(` Endereço: http://localhost:${PORT}`);
  console.log("========================================");
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
