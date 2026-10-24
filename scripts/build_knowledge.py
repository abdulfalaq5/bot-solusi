"""Ringkas knowledge-base-cs.md menjadi teks "Informasi Bisnis" untuk prompt CS AI.

Dokumen asli (~10k token) terlalu besar untuk dikirim di setiap chat (free tier Groq dll. membatasi
token per menit). Bagian 1-6 & 8 disalin apa adanya; daftar solusi (bagian 7) diringkas satu baris
per solusi: nama, harga, untuk siapa, ringkasan, fitur, cocok untuk, link.

Pakai:
  python3 scripts/build_knowledge.py <knowledge-base-cs.md> [output.md]
Lalu tempel hasilnya ke Admin -> Pengaturan -> Informasi bisnis, atau jalankan dengan --apply
untuk langsung menyimpannya ke database lewat docker compose.
"""
import re
import subprocess
import sys
from pathlib import Path


def condense_solution(name: str, lines: list[str]) -> str:
    f = {}
    for ln in lines:
        m = re.match(r"- ([^:]+): (.*)", ln.strip())
        if m:
            f[m.group(1).strip()] = m.group(2).strip()
    status = f.get("Status", "")
    untuk = re.search(r"Untuk: ([^·]+)", status)
    harga = re.search(r"Harga mulai: (.+)$", status)
    parts = [f"- {name}"]
    meta = []
    if harga:
        meta.append(f"mulai {harga.group(1).strip()}")
    if untuk:
        meta.append(f"untuk {untuk.group(1).strip()}")
    if meta:
        parts[0] += f" ({'; '.join(meta)})"
    if "Ringkasan" in f:
        parts.append(f["Ringkasan"])
    if "Fitur" in f:
        parts.append(f"Fitur: {f['Fitur']}.")
    if "Cocok untuk" in f:
        parts.append(f"Cocok: {f['Cocok untuk']}.")
    if "Link" in f:
        parts.append(f["Link"])
    return " ".join(parts)


def build(src: str) -> str:
    out: list[str] = []
    section = ""
    sol_name = None
    sol_lines: list[str] = []

    def flush():
        nonlocal sol_name, sol_lines
        if sol_name:
            out.append(condense_solution(sol_name, sol_lines))
        sol_name, sol_lines = None, []

    for line in src.splitlines():
        if line.startswith("# ") or line.startswith("_Sumber"):
            continue
        if line.startswith("## "):
            flush()
            section = line
            out.append("")
            out.append(line.replace("## ", "### "))
            continue
        if section.startswith("## 7."):
            if line.startswith("#### "):
                flush()
                sol_name = line[5:].strip()
            elif line.startswith("### "):
                flush()
                out.append(f"{line[4:].strip()}:")
            elif sol_name:
                sol_lines.append(line)
            elif line.strip() and not line.startswith("_"):
                out.append(line)
            continue
        if line.strip():
            out.append(line.replace("**", ""))
    flush()
    return "\n".join(out).strip() + "\n"


def main():
    args = [a for a in sys.argv[1:] if a != "--apply"]
    if not args:
        sys.exit(__doc__)
    text = build(Path(args[0]).read_text(encoding="utf-8"))
    if len(args) > 1:
        Path(args[1]).write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)
    print(f"[knowledge] {len(text)} karakter (~{len(text) // 4} token)", file=sys.stderr)
    if "--apply" in sys.argv:
        root = Path(__file__).resolve().parent.parent
        tag = "$kb_ab12$"  # dollar-quoting: isi dokumen tidak perlu di-escape
        sql = (f"INSERT INTO settings (key, value) VALUES ('business_info', to_jsonb({tag}{text}{tag}::text)) "
               "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;")
        subprocess.run(
            ["docker", "compose", "exec", "-T", "postgres", "psql", "-U", "bot", "-d", "botsolusi", "-v", "ON_ERROR_STOP=1", "-q"],
            input=sql, text=True, cwd=root, check=True,
        )
        print("[knowledge] tersimpan ke settings.business_info", file=sys.stderr)


if __name__ == "__main__":
    main()
