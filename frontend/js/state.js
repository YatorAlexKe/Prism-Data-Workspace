// Shared mutable state across pages. Module-load order matters since these are
// referenced by globally-defined onclick handlers and page modules.
let selectedColor = PROJECT_COLORS[0];
let currentResult = null;
let currentSQL = '';
let currentTable = null;
let selectedTables = [];
let templatesVisible = false;
let allDatasets = [];
let chartSuggestion = null;
