import { useState } from "react";
import { Button, Input, Modal } from "@douyinfe/semi-ui";
import { templateCategories, templates } from "../data/catalog";

export default function CreateProjectModal({ visible, onClose, onCreate, initialTemplate = "empty" }: {
  visible: boolean; onClose: () => void; onCreate: (name: string, templateId: string) => void;
  initialTemplate?: string;
}) {
  const [selected, setSelected] = useState(initialTemplate);
  const [category, setCategory] = useState("meshes");
  const [name, setName] = useState(`我的${templates.find((t) => t.id === initialTemplate)?.name ?? "空白地面3D场景"}`);
  const template = templates.find((item) => item.id === selected) ?? templates[0];
  return <Modal title="创建新的项目" visible={visible} onCancel={onClose} footer={null}
    width="min(1200px, 96vw)" className="template-modal" closeOnEsc centered>
    <div className="template-layout">
      <nav className="template-categories" aria-label="项目分类">
        {templateCategories.map((item) => <button key={item.id}
          className={category === item.id ? "active" : ""} onClick={() => setCategory(item.id)}>
          <img src={item.image} alt="" /><span>{item.label}</span>
        </button>)}
      </nav>
      <section className="template-gallery">
        <div className="template-filter"><span>全部</span></div>
        <div className="template-grid">
          {templates.filter((t) => category === "meshes" ||
            (category === "charts" || category === "report" ? t.id === "indoor" :
              category === "gis" ? ["gis-map", "terrain", "city", "campus", "campus-b"].includes(t.id) :
                ["factory", "car", "pipes", "product"].includes(t.id))).map((item) =>
            <button key={item.id} className={`template-card ${selected === item.id ? "active" : ""}`}
              onClick={() => { setSelected(item.id); setName(`我的${item.name}`); }}>
              <img src={item.image} alt="" /><span title={item.name}>{item.name}</span>
            </button>)}
        </div>
      </section>
      <section className="template-details">
        <img className="template-preview" src={template.image} alt={template.name} />
        <h3>{template.name}</h3><p>{template.description}</p>
        <div className="template-create-form">
          <p>· 项目信息：<span>大小 {template.size}</span></p>
          <label htmlFor="new-project-name">项目名称</label>
          <Input id="new-project-name" value={name} onChange={setName} maxLength={50}
            placeholder="请输入项目名称" onEnterPress={() => name.trim() && onCreate(name, selected)} />
          <div><Button onClick={onClose}>取消</Button>
            <Button theme="solid" disabled={!name.trim()} onClick={() => onCreate(name, selected)}>创建项目</Button></div>
        </div>
      </section>
    </div>
    <div className="template-mobile-create"><Input aria-label="项目名称" value={name} onChange={setName} /><Button theme="solid" disabled={!name.trim()} onClick={() => onCreate(name, selected)}>创建项目</Button></div>
  </Modal>;
}
