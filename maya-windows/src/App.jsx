import { Routes, Route, Navigate } from "react-router-dom";
import Home from "./screens/Home.jsx";
import Search from "./screens/Search.jsx";
import Details from "./screens/Details.jsx";
import Player from "./screens/Player.jsx";
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/search" element={<Search />} />
      <Route path="/details/:provider/:id" element={<Details />} />
      <Route path="/player/:provider/:id" element={<Player />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}