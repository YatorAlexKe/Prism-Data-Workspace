import { createContext, useCallback, useContext, useState } from 'react';

// Tiny context that lets any page open the edit-dataset modal by table name.
// Kept separate from AppContext to avoid re-rendering every page when the
// edit modal opens/closes.
const EditDatasetContext = createContext(null);

export function EditDatasetProvider({ children }) {
  const [openTable, setOpenTable] = useState(null);
  const openEditDataset = useCallback((tableName) => setOpenTable(tableName), []);
  const closeEditDataset = useCallback(() => setOpenTable(null), []);
  return (
    <EditDatasetContext.Provider value={{ openTable, openEditDataset, closeEditDataset }}>
      {children}
    </EditDatasetContext.Provider>
  );
}

export function useEditDataset() {
  const ctx = useContext(EditDatasetContext);
  if (!ctx) throw new Error('useEditDataset must be used inside <EditDatasetProvider>');
  return ctx;
}
