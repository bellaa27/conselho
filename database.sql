
USE pre_conselho;

CREATE TABLE IF NOT EXISTS schools (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    code VARCHAR(20) NOT NULL UNIQUE,
    email VARCHAR(190) NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    school_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(150) NOT NULL,
    email VARCHAR(190) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('diretor', 'professor') NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_user_school_email (school_id, email),
    UNIQUE KEY uq_user_id_school (id, school_id),

    CONSTRAINT fk_users_school
      FOREIGN KEY (school_id)
      REFERENCES schools(id)
      ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS classes (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    school_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(100) NOT NULL,
    grade VARCHAR(100) NULL,
    school_year SMALLINT UNSIGNED NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_class_school_name_year
      (school_id, name, school_year),
    UNIQUE KEY uq_class_id_school (id, school_id),

    CONSTRAINT fk_classes_school
      FOREIGN KEY (school_id)
      REFERENCES schools(id)
      ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS teacher_classes (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    school_id BIGINT UNSIGNED NOT NULL,
    teacher_id BIGINT UNSIGNED NOT NULL,
    class_id BIGINT UNSIGNED NOT NULL,

    UNIQUE KEY uq_teacher_class (teacher_id, class_id),

    CONSTRAINT fk_tc_teacher
      FOREIGN KEY (teacher_id, school_id)
      REFERENCES users(id, school_id)
      ON DELETE CASCADE,

    CONSTRAINT fk_tc_class
      FOREIGN KEY (class_id, school_id)
      REFERENCES classes(id, school_id)
      ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS questionnaires (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    school_id BIGINT UNSIGNED NOT NULL,
    created_by BIGINT UNSIGNED NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT NULL,
    status ENUM('rascunho', 'enviado', 'encerrado')
      NOT NULL DEFAULT 'rascunho',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ON UPDATE CURRENT_TIMESTAMP,
    sent_at DATETIME NULL,

    UNIQUE KEY uq_questionnaire_id_school (id, school_id),

    CONSTRAINT fk_questionnaire_school
      FOREIGN KEY (school_id)
      REFERENCES schools(id)
      ON DELETE CASCADE,

    CONSTRAINT fk_questionnaire_creator
      FOREIGN KEY (created_by, school_id)
      REFERENCES users(id, school_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS questions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    school_id BIGINT UNSIGNED NOT NULL,
    questionnaire_id BIGINT UNSIGNED NOT NULL,
    section VARCHAR(150) NULL,
    question_text TEXT NOT NULL,
    question_type ENUM(
      'texto',
      'paragrafo',
      'multipla_escolha',
      'caixas_selecao',
      'sim_nao',
      'nota'
    ) NOT NULL DEFAULT 'texto',
    required BOOLEAN NOT NULL DEFAULT FALSE,
    position INT NOT NULL DEFAULT 0,
    options_json JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_questions_questionnaire
      FOREIGN KEY (questionnaire_id, school_id)
      REFERENCES questionnaires(id, school_id)
      ON DELETE CASCADE,

    INDEX idx_questions_questionnaire
      (school_id, questionnaire_id, position)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS questionnaire_assignments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    school_id BIGINT UNSIGNED NOT NULL,
    questionnaire_id BIGINT UNSIGNED NOT NULL,
    teacher_id BIGINT UNSIGNED NOT NULL,
    class_id BIGINT UNSIGNED NULL,
    assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_assignment_questionnaire
      FOREIGN KEY (questionnaire_id, school_id)
      REFERENCES questionnaires(id, school_id)
      ON DELETE CASCADE,

    CONSTRAINT fk_assignment_teacher
      FOREIGN KEY (teacher_id, school_id)
      REFERENCES users(id, school_id)
      ON DELETE CASCADE,

    CONSTRAINT fk_assignment_class
      FOREIGN KEY (class_id, school_id)
      REFERENCES classes(id, school_id)
      ON DELETE CASCADE,

    INDEX idx_assignments_teacher
      (school_id, teacher_id, questionnaire_id),

    UNIQUE KEY uq_assignment_with_class
      (school_id, questionnaire_id, teacher_id, class_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS answers (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    school_id BIGINT UNSIGNED NOT NULL,
    questionnaire_id BIGINT UNSIGNED NOT NULL,
    teacher_id BIGINT UNSIGNED NOT NULL,
    class_id BIGINT UNSIGNED NULL,
    responses_json JSON NOT NULL,
    submitted_at DATETIME NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_answers_questionnaire
      FOREIGN KEY (questionnaire_id, school_id)
      REFERENCES questionnaires(id, school_id)
      ON DELETE CASCADE,

    CONSTRAINT fk_answers_teacher
      FOREIGN KEY (teacher_id, school_id)
      REFERENCES users(id, school_id)
      ON DELETE CASCADE,

    CONSTRAINT fk_answers_class
      FOREIGN KEY (class_id, school_id)
      REFERENCES classes(id, school_id)
      ON DELETE CASCADE,

    INDEX idx_answers_questionnaire
      (school_id, questionnaire_id),

    INDEX idx_answers_teacher
      (school_id, teacher_id, questionnaire_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS history (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    school_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NULL,
    action VARCHAR(100) NOT NULL,
    description TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_history_school
      FOREIGN KEY (school_id)
      REFERENCES schools(id)
      ON DELETE CASCADE,

    CONSTRAINT fk_history_user
      FOREIGN KEY (user_id, school_id)
      REFERENCES users(id, school_id)
      ON DELETE SET NULL,

    INDEX idx_history_school_date
      (school_id, created_at)
) ENGINE=InnoDB;
