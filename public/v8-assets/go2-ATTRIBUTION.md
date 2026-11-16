# Unitree Go2 开源精细网格参考

来自 Google DeepMind MuJoCo Menagerie 的 unitree_go2，固定提交 71f066ad0be9cd271f7ed58c030243ef157af9f4，原始模型版权属于 Unitree Robotics。BSD-3-Clause 许可全文见 go2-LICENSE.txt。来源 https://github.com/google-deepmind/mujoco_menagerie/tree/71f066ad0be9cd271f7ed58c030243ef157af9f4/unitree_go2。未暗示来源作者为 Embodex 背书。

转换前逐一验证20个原始文件的SHA-256。保留16个OBJ的全部顶点、原始法线、三角面和MJCF body/geom/joint层级，采用原始home关键帧。只转换为glTF float32，不进行减面、单件居中或独立缩放。33个实际可视分件、12个源关节、398,432个实例三角面。

派生处理：Y向上刚性坐标转换与整体落地；将MJCF材料名称映射为PBR表面；组件拆解为真实视觉分件的可逆平移。视觉分件不是制造BOM，不包含未经来源证实的电机内部、齿轮、电路板或螺钉模型。未提供原生CAD、制造公差、工程验证或硬件性能保证。

来源图片 go2-source-preview.png 为上游模型渲染图，不是自行拍摄的实物照片。详见 go2-high-fidelity.json 与 go2-source-provenance.json。
