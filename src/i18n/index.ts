import { getLanguage } from "../lib/config.js";

export type Locale = "en" | "ru";

export interface Translations {
  deploy: {
    packagePrompt: string;
    targetPrompt: string;
  };
  errors: {
    error: string;
  };
  key: {
    title: string;
    list: string;
    add: string;
    remove: string;
    namePrompt: string;
    pathPrompt: string;
    selectRemove: string;
    noKeys: string;
  };
  logs: {
    title: string;
    viewLive: string;
    collect: string;
    daysPrompt: string;
    targetPrompt: string;
  };
  menu: {
    title: string;
    subtitle: string;
    project: string;
    repos: string;
    notInitialized: string;
    whatToDo: string;
    pressEnter: string;
    goodbye: string;
    back: string;
    exit: string;
    // Main menu
    status: string;
    statusDesc: string;
    init: string;
    initDesc: string;
    manageRepos: string;
    manageReposDesc: string;
    manageKeys: string;
    manageKeysDesc: string;
    manageSecrets: string;
    manageSecretsDesc: string;
    pull: string;
    pullDesc: string;
    build: string;
    buildDesc: string;
    pack: string;
    packDesc: string;
    deploy: string;
    deployDesc: string;
    verify: string;
    verifyDesc: string;
    rollback: string;
    rollbackDesc: string;
    logs: string;
    logsDesc: string;
    tasks: string;
    tasksDesc: string;
    // Sections
    sectionSetup: string;
    sectionWorkflow: string;
    sectionDeploy: string;
    // Disabled reasons
    initFirst: string;
    alreadyInitialized: string;
    initGlobalFirst: string;
    addReposFirst: string;
    // Language
    language: string;
    languageDesc: string;
    selectLanguage: string;
    languageSaved: string;
    sectionSettings: string;
  };
  repo: {
    title: string;
    list: string;
    add: string;
    remove: string;
    urlPrompt: string;
    selectRemove: string;
    noRepos: string;
  };
  rollback: {
    title: string;
    listVersions: string;
    rollbackPrevious: string;
    rollbackSpecific: string;
    versionPrompt: string;
  };
  secrets: {
    title: string;
    setup: string;
    import: string;
    list: string;
    check: string;
    export: string;
    filePrompt: string;
    noSecrets: string;
  };
  tasks: {
    title: string;
    list: string;
    run: string;
    taskPrompt: string;
    noTasks: string;
  };
  verify: {
    packagePrompt: string;
  };
}

const en: Translations = {
  menu: {
    title: "CIN CLI v0.1.0",
    subtitle: "Airgapped Deployment Tool",
    project: "Project",
    repos: "Repos",
    notInitialized: "not initialized",
    whatToDo: "What would you like to do?",
    pressEnter: "Press Enter to continue...",
    goodbye: "Goodbye!",
    back: "← Back",
    exit: "Exit",
    status: "Status",
    statusDesc: "Show project status",
    init: "Init",
    initDesc: "Initialize project",
    manageRepos: "Manage repos",
    manageReposDesc: "Add/remove repositories",
    manageKeys: "Manage SSH keys",
    manageKeysDesc: "Add/remove SSH keys",
    manageSecrets: "Manage secrets",
    manageSecretsDesc: "Configure app secrets",
    pull: "Pull",
    pullDesc: "Fetch code from repos",
    build: "Build",
    buildDesc: "Build Docker images",
    pack: "Pack",
    packDesc: "Create offline package",
    deploy: "Deploy",
    deployDesc: "Deploy package to target",
    verify: "Verify",
    verifyDesc: "Verify package integrity",
    rollback: "Rollback",
    rollbackDesc: "Restore previous version",
    logs: "Logs",
    logsDesc: "View or collect logs",
    tasks: "Tasks",
    tasksDesc: "Run configured tasks",
    sectionSetup: "Setup",
    sectionWorkflow: "Workflow",
    sectionDeploy: "Deploy",
    initFirst: "Initialize project first",
    alreadyInitialized: "Already initialized",
    initGlobalFirst: "Initialize global config first",
    addReposFirst: "Add repositories first",
    language: "Language",
    languageDesc: "Change interface language",
    selectLanguage: "Select language:",
    languageSaved: "Language saved",
    sectionSettings: "Settings",
  },
  repo: {
    title: "Repositories",
    list: "List repositories",
    add: "Add repository",
    remove: "Remove repository",
    urlPrompt: "Repository URL:",
    selectRemove: "Select repository to remove:",
    noRepos: "No repositories to remove",
  },
  key: {
    title: "SSH Keys",
    list: "List keys",
    add: "Add key",
    remove: "Remove key",
    namePrompt: "Key name:",
    pathPrompt: "Path to key file:",
    selectRemove: "Select key to remove:",
    noKeys: "No keys to remove",
  },
  secrets: {
    title: "Secrets",
    setup: "Interactive setup",
    import: "Import from file",
    list: "List secrets",
    check: "Check required",
    export: "Export to file",
    filePrompt: "Path to secrets file:",
    noSecrets: "No secrets configured",
  },
  logs: {
    title: "Logs",
    viewLive: "View live logs",
    collect: "Collect for diagnostics",
    daysPrompt: "Days to collect:",
    targetPrompt: "Target directory:",
  },
  tasks: {
    title: "Tasks",
    list: "List tasks",
    run: "Run task",
    taskPrompt: "Task name:",
    noTasks: "No tasks configured",
  },
  deploy: {
    packagePrompt: "Path to package (.tar.gz):",
    targetPrompt: "Target directory:",
  },
  verify: {
    packagePrompt: "Path to package (.tar.gz):",
  },
  rollback: {
    title: "Rollback",
    listVersions: "List versions",
    rollbackPrevious: "Rollback to previous",
    rollbackSpecific: "Rollback to specific version",
    versionPrompt: "Version name:",
  },
  errors: {
    error: "Error",
  },
};

const ru: Translations = {
  menu: {
    title: "CIN CLI v0.1.0",
    subtitle: "Доставка в закрытый контур",
    project: "Проект",
    repos: "Репозитории",
    notInitialized: "не инициализирован",
    whatToDo: "Что вы хотите сделать?",
    pressEnter: "Нажмите Enter для продолжения...",
    goodbye: "До свидания!",
    back: "← Назад",
    exit: "Выход",
    status: "Статус",
    statusDesc: "Показать статус проекта",
    init: "Инициализация",
    initDesc: "Инициализировать проект",
    manageRepos: "Репозитории",
    manageReposDesc: "Добавить/удалить репозитории",
    manageKeys: "SSH ключи",
    manageKeysDesc: "Добавить/удалить SSH ключи",
    manageSecrets: "Секреты",
    manageSecretsDesc: "Настроить секреты приложения",
    pull: "Получить",
    pullDesc: "Получить код из репозиториев",
    build: "Собрать",
    buildDesc: "Собрать Docker образы",
    pack: "Упаковать",
    packDesc: "Создать оффлайн-пакет",
    deploy: "Развернуть",
    deployDesc: "Развернуть пакет на сервере",
    verify: "Проверить",
    verifyDesc: "Проверить целостность пакета",
    rollback: "Откатить",
    rollbackDesc: "Восстановить предыдущую версию",
    logs: "Логи",
    logsDesc: "Просмотр и сбор логов",
    tasks: "Задачи",
    tasksDesc: "Запуск настроенных задач",
    sectionSetup: "Настройка",
    sectionWorkflow: "Рабочий процесс",
    sectionDeploy: "Развёртывание",
    initFirst: "Сначала инициализируйте проект",
    alreadyInitialized: "Уже инициализирован",
    initGlobalFirst: "Сначала инициализируйте глобальный конфиг",
    addReposFirst: "Сначала добавьте репозитории",
    language: "Язык",
    languageDesc: "Изменить язык интерфейса",
    selectLanguage: "Выберите язык:",
    languageSaved: "Язык сохранён",
    sectionSettings: "Настройки",
  },
  repo: {
    title: "Репозитории",
    list: "Список репозиториев",
    add: "Добавить репозиторий",
    remove: "Удалить репозиторий",
    urlPrompt: "URL репозитория:",
    selectRemove: "Выберите репозиторий для удаления:",
    noRepos: "Нет репозиториев для удаления",
  },
  key: {
    title: "SSH ключи",
    list: "Список ключей",
    add: "Добавить ключ",
    remove: "Удалить ключ",
    namePrompt: "Имя ключа:",
    pathPrompt: "Путь к файлу ключа:",
    selectRemove: "Выберите ключ для удаления:",
    noKeys: "Нет ключей для удаления",
  },
  secrets: {
    title: "Секреты",
    setup: "Настройка",
    import: "Импорт из файла",
    list: "Список секретов",
    check: "Проверить",
    export: "Экспорт в файл",
    filePrompt: "Путь к файлу секретов:",
    noSecrets: "Секреты не настроены",
  },
  logs: {
    title: "Логи",
    viewLive: "Просмотр в реальном времени",
    collect: "Собрать для диагностики",
    daysPrompt: "За сколько дней:",
    targetPrompt: "Целевая директория:",
  },
  tasks: {
    title: "Задачи",
    list: "Список задач",
    run: "Запустить задачу",
    taskPrompt: "Имя задачи:",
    noTasks: "Задачи не настроены",
  },
  deploy: {
    packagePrompt: "Путь к пакету (.tar.gz):",
    targetPrompt: "Целевая директория:",
  },
  verify: {
    packagePrompt: "Путь к пакету (.tar.gz):",
  },
  rollback: {
    title: "Откат",
    listVersions: "Список версий",
    rollbackPrevious: "Откатить к предыдущей",
    rollbackSpecific: "Откатить к конкретной версии",
    versionPrompt: "Имя версии:",
  },
  errors: {
    error: "Ошибка",
  },
};

const translations: Record<Locale, Translations> = { en, ru };

let currentLocale: Locale = "en";

function detectLocale(): Locale {
  // 1. Check CIN_LANG environment variable
  const envLang = process.env.CIN_LANG?.toLowerCase();
  if (envLang === "ru" || envLang === "russian") {
    return "ru";
  }
  if (envLang === "en" || envLang === "english") {
    return "en";
  }

  // 2. Check global config
  try {
    const configLang = getLanguage();
    if (configLang) {
      return configLang;
    }
  } catch {
    // Config might not exist yet
  }

  // 3. Check system locale
  const systemLang = process.env.LANG ?? process.env.LC_ALL ?? "";
  if (systemLang.startsWith("ru")) {
    return "ru";
  }

  return "en";
}

export function initLocale(): void {
  currentLocale = detectLocale();
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

export function t(): Translations {
  return translations[currentLocale];
}

// Initialize on module load
initLocale();
