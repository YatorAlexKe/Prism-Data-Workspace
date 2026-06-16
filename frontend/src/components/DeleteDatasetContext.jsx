import { createContext, useCallback, useContext, useState } from 'react';

// Mirrors EditDatasetContext: any page can open the delete-confirmation modal
// by table name, without re-rendering siblings when it toggles.
const DeleteDatasetContext = createContext(null);

export function DeleteDatasetProvider({ children }) {
  const [pendingTable, setPendingTable] = useState(null);
  const openDeleteDataset = useCallback((tableName) => setPendingTable(tableName), []);
  const closeDeleteDataset = useCallback(() => setPendingTable(null), []);
  return (
    <DeleteDatasetContext.Provider value={{ pendingTable, openDeleteDataset, closeDeleteDataset }}>
      {children}
    </DeleteDatasetContext.Provider>
  );
}

export function useDeleteDataset() {
  const ctx = useContext(DeleteDatasetContext);
  if (!ctx) throw new Error('useDeleteDataset must be used inside <DeleteDatasetProvider>');
  return ctx;
}
