package com.kimjammin.chessbot.engine;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.util.ArrayList;
import java.util.List;

/** 앱에 들어 있는 Stockfish 실행 파일과 UCI 로 대화한다. */
public final class Stockfish {
    public static final int MATE = 100_000;

    public static final class Line {
        public String move;
        public int score; // 둘 차례 기준 센티폰, 메이트는 ±(100000 - 수)
    }

    private Process proc;
    private BufferedWriter w;
    private BufferedReader r;

    public boolean start(String path, int threads, int hashMb) {
        try {
            proc = new ProcessBuilder(path).redirectErrorStream(true).start();
            w = new BufferedWriter(new OutputStreamWriter(proc.getOutputStream()));
            r = new BufferedReader(new InputStreamReader(proc.getInputStream()));
            send("uci");
            if (!waitFor("uciok")) return fail();
            send("setoption name Threads value " + threads);
            send("setoption name Hash value " + hashMb);
            send("isready");
            if (!waitFor("readyok")) return fail();
            return true;
        } catch (IOException e) {
            return fail();
        }
    }

    /** multipv 개의 후보수를 좋은 순서로 */
    public synchronized List<Line> analyse(String fen, int ms, int multipv) throws IOException {
        send("setoption name MultiPV value " + multipv);
        send("position fen " + fen);
        send("go movetime " + ms);
        Line[] lines = new Line[multipv];
        String s;
        while ((s = r.readLine()) != null) {
            if (s.startsWith("bestmove")) {
                List<Line> out = new ArrayList<>();
                for (Line l : lines) if (l != null && l.move != null) out.add(l);
                String[] t = s.split("\\s+");
                if (out.isEmpty() && t.length > 1 && !t[1].equals("(none)")) {
                    Line l = new Line();
                    l.move = t[1];
                    out.add(l);
                }
                if (out.isEmpty() && lines[0] != null) out.add(lines[0]); // 둘 수 없음(메이트/스테일메이트)
                return out;
            }
            if (s.startsWith("info") && s.contains(" score ")) parseInfo(s.split("\\s+"), lines);
        }
        throw new IOException("stockfish stopped");
    }

    private static void parseInfo(String[] t, Line[] lines) {
        int k = 1, score = 0;
        String move = null;
        boolean has = false;
        for (int i = 1; i < t.length - 1; i++) {
            switch (t[i]) {
                case "multipv": k = Integer.parseInt(t[i + 1]); break;
                case "cp": score = Integer.parseInt(t[i + 1]); has = true; break;
                case "mate": {
                    int n = Integer.parseInt(t[i + 1]);
                    score = n > 0 ? MATE - n : -MATE - n;
                    has = true;
                    break;
                }
                case "pv": move = t[i + 1]; i = t.length; break;
            }
        }
        if (!has || k < 1 || k > lines.length) return;
        if (lines[k - 1] == null) lines[k - 1] = new Line();
        lines[k - 1].score = score;
        if (move != null) lines[k - 1].move = move;
    }

    public void stop() {
        try { send("quit"); } catch (IOException ignored) { }
        if (proc != null) proc.destroy();
    }

    private void send(String cmd) throws IOException {
        w.write(cmd);
        w.write('\n');
        w.flush();
    }

    private boolean waitFor(String token) throws IOException {
        String s;
        while ((s = r.readLine()) != null) if (s.startsWith(token)) return true;
        return false;
    }

    private boolean fail() {
        if (proc != null) proc.destroy();
        return false;
    }
}
