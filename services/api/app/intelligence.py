"""Deterministic, inspectable local tools; no fabricated candidate facts."""
import io
import logging
import re
import time
import zipfile
from fastapi import HTTPException

SKILLS = ['Python', 'JavaScript', 'TypeScript', 'Java', 'C++', 'C', 'SQL', 'React', 'Next.js', 'Node.js', 'FastAPI', 'Django', 'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Docker', 'Kubernetes', 'AWS', 'Azure', 'GCP', 'Git', 'Linux', 'TensorFlow', 'PyTorch', 'Machine Learning', 'Deep Learning', 'NLP', 'REST', 'GraphQL', 'HTML', 'CSS', 'Figma', 'Excel', 'Power BI', 'Tableau']
logging.getLogger('pypdf').setLevel(logging.CRITICAL + 1)  # Parser warnings may quote private malformed input.


def words(text): return set(re.findall(r'[a-z0-9][a-z0-9+#.]*', text.lower()))
def tokens(text): return max(1, (len(text.encode('utf-8')) + 2) // 3)


def analyze_resume(text, job=''):
    def mentioned(skill, value): return re.search(r'(?<![\w+#])' + re.escape(skill) + r'(?![\w+#])', value, re.I)
    skills = [s for s in SKILLS if mentioned(s, text)]
    lines = [x.strip() for x in text.splitlines() if x.strip()]
    sections = {}
    current = None
    for line in lines:
        if re.fullmatch(r'(education|projects?|experience|work experience|skills|certifications|summary)[: ]*', line, re.I):
            current = line.rstrip(':').lower()
            sections[current] = []
        elif current:
            sections[current].append(line)
    bullets = [line for line in lines if re.match(r'^[-•*]', line)]
    metrics = [line for line in bullets if re.search(r'\d', line)]
    checks = {'hasEducationSection': 'education' in sections, 'hasExperienceSection': any('experience' in k for k in sections), 'hasProjectSection': any('project' in k for k in sections), 'hasSkills': bool(skills), 'hasMeasurableBullet': bool(metrics)}
    jd_skills = [s for s in SKILLS if mentioned(s, job)]
    matched = [s for s in jd_skills if s in skills]
    missing = [s for s in jd_skills if s not in skills]
    return {'method': 'deterministic text checklist and explicit skill matching; not an ATS prediction', 'aiGenerated': False, 'skills': skills, 'sections': sections, 'bullets': bullets, 'score': sum(checks.values()) * 20, 'criteria': checks, 'suggestions': [f'Add or clarify {k.removeprefix("has").removesuffix("Section")}' for k, v in checks.items() if not v], 'match': {'score': round(100 * len(matched) / len(jd_skills)) if jd_skills else None, 'matchedSkills': matched, 'missingSkills': missing, 'requiredSkills': jd_skills}, 'bulletGuidance': 'Use action + specific contribution + evidence. Add only numbers and outcomes you can substantiate.'}


def extract_document(filename, data):
    extension = filename.lower().rsplit('.', 1)[-1]
    try:
        if extension == 'pdf':
            if not data.startswith(b'%PDF-'): raise HTTPException(422, 'Document contents do not match PDF format')
            from pypdf import PdfReader
            pdf = PdfReader(io.BytesIO(data))
            if pdf.is_encrypted: raise HTTPException(422, 'Encrypted PDF is unsupported')
            if len(pdf.pages) > 200: raise HTTPException(413, 'Document exceeds 200 pages')
            text = '\n'.join(page.extract_text() or '' for page in pdf.pages)
        elif extension == 'docx':
            # Bound decompression before handing an archive to the parser.
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                if sum(i.file_size for i in archive.infolist()) > 25 * 1024 * 1024:
                    raise HTTPException(413, 'DOCX expanded size limit exceeded')
            from docx import Document
            doc = Document(io.BytesIO(data))
            text = '\n'.join([p.text for p in doc.paragraphs] + [' | '.join(c.text for c in r.cells) for t in doc.tables for r in t.rows])
        elif extension in {'txt', 'md', 'csv', 'py', 'js', 'ts', 'java', 'c', 'cpp', 'json'}:
            text = data.decode('utf-8-sig')
        else:
            raise HTTPException(415, 'Supported extraction: PDF, DOCX, UTF-8 text, Markdown, CSV and code. OCR requires a configured image adapter.')
    except HTTPException: raise
    except Exception:
        raise HTTPException(422, 'Could not parse this document; provide a valid unencrypted file')
    if len(text) > 500000: raise HTTPException(413, 'Extracted text exceeds 500000 characters')
    if not text.strip(): raise HTTPException(422, 'No extractable text; scanned images require OCR')
    return text


def optimize(query, documents, budget):
    start = time.perf_counter()
    seen, chunks = set(), []
    q = words(query)
    before = sum(tokens(d['text']) for d in documents)
    for document in documents:
        # Complete source lines/paragraphs are selected verbatim. Oversize source units are omitted,
        # never truncated into altered technical facts. Code fences are atomic.
        units = re.split(r'(```[\s\S]*?```)', document['text'])
        source_units = []
        for unit in units:
            source_units.extend([unit] if unit.startswith('```') else [s for s in re.split(r'\n\s*\n|(?<=\.)\s+(?=[A-Z])', unit) if s.strip()])
        for position, content in enumerate(source_units):
            key = re.sub(r'\s+', ' ', content).strip()
            if key in seen: continue
            seen.add(key)
            terms = words(content)
            score = len(q & terms) / max(1, len(q))
            if re.search(r'\d|```|must|constraint|limit', content, re.I): score += 0.05
            chunks.append((score, document['id'], position, content.strip()))
    selected, used = [], 0
    for score, doc_id, pos, content in sorted(chunks, key=lambda x: -x[0]):
        cost = tokens(content) + 8
        if used + cost <= budget:
            selected.append({'sourceId': doc_id, 'position': pos, 'text': content, 'score': round(score, 4)})
            used += cost
    return {'chunks': selected, 'text': '\n\n'.join(c['text'] for c in selected), 'tokensBefore': before, 'tokensAfter': used, 'budget': budget, 'latencyMs': round((time.perf_counter() - start) * 1000, 2), 'method': 'extractive lexical ranking, atomic fact/code preservation, deduplication', 'headroom': 'Not enabled: deterministic adapter requires no external model and preserves selected source units verbatim', 'omittedUnits': len(chunks) - len(selected), 'quality': 'Selected units are verbatim; omitted context can reduce recall. Review sources before relying on the result.'}


def evaluate_answer(text, concepts):
    matched = [c for c in concepts if c.lower() in text.lower()]
    criteria = {'conceptCoverage': round(5 * len(matched) / len(concepts), 1) if concepts else None, 'structure': 5 if len(text.split()) >= 50 else 2, 'exampleIncluded': 5 if re.search(r'example|for instance|such as', text, re.I) else 1}
    scored = [x for x in criteria.values() if x is not None]
    return {'method': 'deterministic practice rubric; does not verify technical correctness', 'aiGenerated': False, 'score': round(sum(scored) / len(scored) * 20), 'criteria': criteria, 'missingConcepts': [c for c in concepts if c not in matched], 'suggestions': ['State your approach, give a concrete example and discuss one trade-off.', 'Review concept coverage; mention matching is lexical and can miss valid paraphrases.']}
