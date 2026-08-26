#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Escanea tu historial de Claude Code y muestra QUÉ LE PEDÍS MÁS SEGUIDO.

Todo pasa en tu máquina: lee un archivo local, cuenta y escribe el resultado en pantalla.
No se conecta a internet, no manda nada a ningún lado y no escribe ni borra nada tuyo.
Son unas 200 líneas y podés leerlas enteras antes de correrlo.

  python escanear.py                    todo el historial
  python escanear.py --dias 90          solo los últimos 90 días
  python escanear.py --proyecto .       solo los pedidos hechos en esta carpeta
  python escanear.py --top 30           cuántos temas mostrar (por defecto 20)
"""
import argparse
import json
import os
import re
import sys
import time
import unicodedata
from collections import Counter, defaultdict

# En Windows la consola sale en cp1252 y cualquier simbolo (·, ⚠, —) rompe el script
# justo al imprimir. Se fuerza UTF-8 en la salida antes de escribir nada.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# El historial de pedidos que guarda Claude Code.
HISTORIAL = os.path.join(os.path.expanduser("~"), ".claude", "history.jsonl")

# Palabras que no dicen nada del proceso: se sacan antes de agrupar.
VACIAS = set("""
a al algo ahi ahora aca aparte asi aunque bien bueno cada como con contra cosa cosas cual
cuando dale de del desde donde dos el ella ellos en entonces entre era eran es esa ese eso
esta estan este esto estos fue fui hace hacer hay igual la las le les lo los mas me mi mismo
mucho muy nada ni no nos o para pero poco por porque que se sea segun ser si sin sobre solo
son su sus tal tambien tan te tiene todo todos tu un una uno unos ver vez y ya
ahora bueno che dale gracias listo ok okey perfecto please por favor si
""".split())

# Verbos con los que se pide algo: sirven para reconocer un pedido de verdad.
VERBOS = set("""
abri abrir agrega agregar arma armar arregla arreglar analiza analizar borra borrar busca
buscar calcula calcular cambia cambiar carga cargar chequea chequear cierra cerrar copia
copiar corre correr crea crear dame decime deja dejar edita editar escribi escribir exporta
exportar genera generar guarda guardar haceme hace hacer instala instalar limpia limpiar
lee leer manda mandar mira mirar mostra mostrar pasa pasar prepara preparar proba probar
publica publicar revisa revisar saca sacar sube subir sumale traeme trae traer valida validar
verifica verificar
""".split())

# Palabras con las que se pide, pero que no nombran nada: sirven para reconocer un pedido,
# no para titular el tema. "dame + video" no dice nada; "video + descripcion" sí.
CONVERSACIONALES = set("""
quiero queria querria quisiera necesito gustaria hagas haga hagamos hago hacemos hiciste
seria serian sera capaz podria podriamos podes puedo puede deberia decime contame fijate
teniendo tener tenes tengo cuenta viendo siendo haciendo diciendo dando
mira mismo parece pasa pasar tema temas cosa cosas manera forma ahora antes despues bueno
igual medio toda todas todo todos ultimo ultima ultimos ultimas nuevo nueva mejor peor
""".split())

# Cómo arranca una corrección: sirve para detectar lo que sale mal seguido.
CORRECCION = re.compile(
    r"^\s*(no,|no\.|no |eso no|esta mal|está mal|mal |te equivoc|otra vez|de nuevo|"
    r"volve|volvé|corregi|corregí|arregla eso|no era|no es eso|fijate que)", re.I)

# Ruido que ensucia el conteo: links, rutas de archivos y los marcadores que mete la terminal
# cuando pegás algo. Si no se sacan, el tema más repetido termina siendo "pasted text".
RUIDO = [
    re.compile(r"\[(pasted text|image|imagen)[^\]]*\]", re.I),  # [Pasted text #3 +4 lines]
    re.compile(r"https?://\S+"),                                 # links
    re.compile(r"[a-zA-Z]:[\\/][^\s'\"]+"),                      # c:\Users\...
    re.compile(r"(?<![\w.])[\\/][^\s'\"]{6,}"),                  # /home/... o \carpeta\...
    re.compile(r"&\s*'[^']*'"),                                  # & 'archivo.png'
]


# Ni los verbos de pedido ni las conversacionales pueden titular un tema.
NO_TITULAN = VERBOS | CONVERSACIONALES


def sin_ruido(texto):
    for r in RUIDO:
        texto = r.sub(" ", texto)
    return " ".join(texto.split())


def limpiar(texto):
    """Minúsculas, sin tildes y sin signos: para poder comparar palabras."""
    t = unicodedata.normalize("NFD", sin_ruido(texto).lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9ñ ]+", " ", t)


def palabras_utiles(texto):
    return [p for p in limpiar(texto).split() if len(p) > 2 and p not in VACIAS]


def misma_raiz(a, b):
    """'video' y 'videos' son la misma cosa: no vale la pena armar un tema con las dos."""
    corto, largo = (a, b) if len(a) <= len(b) else (b, a)
    return largo.startswith(corto) and len(largo) - len(corto) <= 2


def leer_historial(ruta, dias=None, proyecto=None):
    """Devuelve la lista de pedidos. Si el archivo no está, lo dice y no rompe."""
    if not os.path.exists(ruta):
        print("No encontré el historial en:", ruta)
        print("Puede que uses Claude Code hace muy poco, o en otra cuenta de la máquina.")
        print("Podemos seguir igual: contame vos qué hacés seguido.")
        return []

    corte = (time.time() - dias * 86400) * 1000 if dias else None
    proyecto = os.path.abspath(proyecto) if proyecto else None

    pedidos = []
    with open(ruta, encoding="utf-8", errors="ignore") as f:
        for linea in f:
            linea = linea.strip()
            if not linea:
                continue
            try:
                d = json.loads(linea)
            except json.JSONDecodeError:
                continue  # una línea rota no tira abajo el análisis
            texto = (d.get("display") or "").strip()
            if not texto:
                continue
            ts = d.get("timestamp") or 0
            if corte and ts < corte:
                continue
            if proyecto and os.path.abspath(d.get("project") or "") != proyecto:
                continue
            pedidos.append({"texto": texto, "ts": ts, "proyecto": d.get("project") or ""})
    return pedidos


def fecha(ts):
    return time.strftime("%d/%m/%Y", time.localtime(ts / 1000)) if ts else "?"


def agrupar_por_tema(pedidos, top):
    """
    Agrupa los pedidos por las dos palabras que más aparecen juntas.
    No es magia: cuenta pares de palabras y junta los pedidos que los comparten.
    """
    pares = Counter()
    indice = defaultdict(list)

    for i, p in enumerate(pedidos):
        ps = palabras_utiles(p["texto"])[:14]  # las primeras alcanzan: ahí está el pedido
        if len(ps) < 3:
            continue  # "dale", "abrilo", o un pedido que era solo un link
        vistos = set()
        for a in range(len(ps)):
            for b in range(a + 1, min(a + 5, len(ps))):
                # El título del tema tiene que decir DE QUÉ se trata, no cómo se pidió.
                if ps[a] in NO_TITULAN or ps[b] in NO_TITULAN:
                    continue
                if misma_raiz(ps[a], ps[b]):
                    continue
                par = tuple(sorted((ps[a], ps[b])))
                if par in vistos or par[0] == par[1]:
                    continue
                vistos.add(par)
                pares[par] += 1
                indice[par].append(i)

    temas, usados = [], []
    for par, cuenta in pares.most_common(600):
        if cuenta < 3:
            break
        ids = set(indice[par])
        # Si este tema es casi el mismo que uno que ya guardé, lo salteo. Y si comparte
        # una palabra con otro tema, alcanza con que se pisen un tercio para que sea el mismo
        # ("informe + cliente" e "informes + cliente" son una sola cosa).
        repetido = False
        for par_previo, otros in usados:
            pisa = len(ids & otros) / len(ids)
            comparten = set(par) & set(par_previo)
            if pisa > 0.6 or (comparten and pisa > 0.3):
                repetido = True
                break
        if repetido:
            continue
        usados.append((par, ids))
        temas.append({"par": par, "ids": sorted(ids)})
        if len(temas) >= top:
            break
    return temas


def informe(pedidos, temas):
    fechas = [p["ts"] for p in pedidos if p["ts"]]
    print("=" * 74)
    print("QUÉ LE PEDÍS A CLAUDE — leído de tu historial, en tu máquina")
    print("=" * 74)
    print("Pedidos analizados: %d" % len(pedidos))
    if fechas:
        print("Desde %s hasta %s" % (fecha(min(fechas)), fecha(max(fechas))))
    proyectos = Counter(os.path.basename(p["proyecto"].rstrip("\\/")) for p in pedidos if p["proyecto"])
    if len(proyectos) > 1:
        print("Carpetas: " + " · ".join("%s (%d)" % (n, c) for n, c in proyectos.most_common(6)))
    print()

    comandos = Counter(re.match(r"^/([a-z0-9\-:]+)", p["texto"], re.I).group(1).lower()
                       for p in pedidos if re.match(r"^/[a-z0-9\-:]+", p["texto"], re.I))
    if comandos:
        print("-" * 74)
        print("LO QUE YA TENÉS AUTOMATIZADO (comandos que usás)")
        print("-" * 74)
        for nombre, veces in comandos.most_common(10):
            print("  /%-28s %4d veces" % (nombre, veces))
        print()

    print("-" * 74)
    print("LO QUE MÁS REPETÍS  (candidatos a skill)")
    print("-" * 74)
    for n, tema in enumerate(temas, 1):
        ids = tema["ids"]
        grupo = [pedidos[i] for i in ids]
        tss = [p["ts"] for p in grupo if p["ts"]]
        correcciones = sum(1 for p in grupo if CORRECCION.match(p["texto"]))
        # Los días distintos importan: 20 pedidos en un día es una tarde, no una rutina.
        dias_distintos = len({fecha(p["ts"]) for p in grupo if p["ts"]})
        con_verbo = [p for p in grupo if set(palabras_utiles(p["texto"])[:4]) & VERBOS]
        ejemplos = (con_verbo or grupo)[:3]

        print("\n%2d. %s   —   %d veces, en %d días distintos" %
              (n, " + ".join(tema["par"]).upper(), len(ids), dias_distintos))
        if tss:
            print("    de %s a %s" % (fecha(min(tss)), fecha(max(tss))))

        # Las otras palabras del grupo dicen de qué se trata mejor que el par solo.
        otras = Counter(w for p in grupo for w in set(palabras_utiles(p["texto"])[:14]))
        for w in tema["par"]:
            otras.pop(w, None)
        contexto = [w for w, c in otras.most_common(6) if c >= max(2, len(ids) // 4)]
        if contexto:
            print("    también aparece: " + ", ".join(contexto))
        if correcciones:
            print("    ⚠ %d de esos pedidos son correcciones: acá algo sale mal seguido" % correcciones)
        for p in ejemplos:
            t = sin_ruido(p["texto"])
            print("      · " + (t[:96] + "…" if len(t) > 96 else t))

    print()
    print("-" * 74)
    print("Esto es solo la cuenta. Lo que decide cuáles conviene convertir en skill")
    print("va en el paso siguiente, con criterio: hay cosas repetidas que NO son skills.")
    print("-" * 74)


def main():
    ap = argparse.ArgumentParser(description="Mira qué le pedís más seguido a Claude Code.")
    ap.add_argument("--dias", type=int, default=None, help="solo los últimos N días")
    ap.add_argument("--proyecto", default=None, help="solo los pedidos de esta carpeta")
    ap.add_argument("--top", type=int, default=20, help="cuántos temas mostrar")
    ap.add_argument("--archivo", default=HISTORIAL, help="ruta del historial, si la tuya es otra")
    args = ap.parse_args()

    pedidos = leer_historial(args.archivo, args.dias, args.proyecto)
    if not pedidos:
        return 0
    if len(pedidos) < 25:
        print("Encontré solo %d pedidos%s." % (len(pedidos), " en ese período" if args.dias else ""))
        print("Es poco para sacar conclusiones. Probá sin --dias, o vamos por las preguntas.")
        print()
    informe(pedidos, agrupar_por_tema(pedidos, args.top))
    return 0


if __name__ == "__main__":
    sys.exit(main())
