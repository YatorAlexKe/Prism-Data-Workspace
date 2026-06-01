import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Sidebar from './components/Sidebar.jsx';
import TopBar from './components/TopBar.jsx';
import EditDatasetModal from './components/EditDatasetModal.jsx';
import { EditDatasetProvider } from './components/EditDatasetContext.jsx';
import DeleteDatasetModal from './components/DeleteDatasetModal.jsx';
import { DeleteDatasetProvider } from './components/DeleteDatasetContext.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Ingest from './pages/Ingest.jsx';
import Query from './pages/Query.jsx';
import Profile from './pages/Profile.jsx';
import Projects from './pages/Projects.jsx';
import History from './pages/History.jsx';
import { useApp } from './AppContext.jsx';

export default function App() {
  const { refreshDatasets, loadHistoryCount } = useApp();

  // Boot sequence (was inline <script> at the bottom of the old index.html):
  // populate the sidebar dataset list and history badge once on mount.
  useEffect(() => {
    refreshDatasets();
    loadHistoryCount();
  }, [refreshDatasets, loadHistoryCount]);

  return (
    <EditDatasetProvider>
      <DeleteDatasetProvider>
        <Sidebar />
        <div className="main">
          <TopBar />
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/ingest" element={<Ingest />} />
            <Route path="/query" element={<Query />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/history" element={<History />} />
          </Routes>
        </div>
        <EditDatasetModal />
        <DeleteDatasetModal />
      </DeleteDatasetProvider>
    </EditDatasetProvider>
  );
}
