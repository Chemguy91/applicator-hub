import React, { useEffect, useRef } from "react";
import { mountSproutNipGame } from "../demo/sproutNipGame.js";

export default function Demo() {
  const box = useRef(null);
  useEffect(() => {
    const game = mountSproutNipGame(box.current);
    return () => game.destroy();
  }, []);
  return (
    <div className="demo">
      <h1 className="page-title">Fog the storage</h1>
      <p className="setup-sub">Pour, heat, fan and fog until every duct is full.</p>
      <div ref={box} />
    </div>
  );
}
