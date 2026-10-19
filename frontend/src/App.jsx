import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import Sidebar from './components/Sidebar.jsx';
import TopBar from './components/TopBar.jsx';
import EditDatasetModal from './components/EditDatasetModal.jsx';
import { EditDatasetProvider } from './components/EditDatasetContext.jsx';
import DeleteDatasetModal from './components/DeleteDatasetModal.jsx';
import { DeleteDatasetProvider } from './components/DeleteDatasetContext.jsx';
import Connections from './pages/Connections.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Ingest from './pages/Ingest.jsx';
import Query from './pages/Query.jsx';
import Profile from './pages/Profile.jsx';
import Projects from './pages/Projects.jsx';
import History from './pages/History.jsx';
import Welcome from './pages/Welcome.jsx';
import NotFound from './pages/NotFound.jsx';
import { useApp } from './AppContext.jsx';

export default function App() {
  const { refreshDatasets, loadHistoryCount } = useApp();
  const { pathname } = useLocation();

  // Boot sequence (was inline <script> at the bottom of the old index.html):
  // populate the sidebar dataset list and history badge once on mount.
  useEffect(() => {
    refreshDatasets();
    loadHistoryCount();
  }, [refreshDatasets, loadHistoryCount]);

  // The welcome screen is full-bleed, outside the Sidebar/TopBar shell.
  if (pathname === '/') return <Welcome />;

  return (
    <EditDatasetProvider>
      <DeleteDatasetProvider>
        <Sidebar />
        <div className="main">
          <TopBar />
          <Routes>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/ingest" element={<Ingest />} />
            <Route path="/query" element={<Query />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/profile/:tableName" element={<Profile />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/history" element={<History />} />
            <Route path="/connections" element={<Connections />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
        <EditDatasetModal />
        <DeleteDatasetModal />
      </DeleteDatasetProvider>
    </EditDatasetProvider>
  );
}
